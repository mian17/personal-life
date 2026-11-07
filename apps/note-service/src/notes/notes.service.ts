import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { IsNull, Not, Repository } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { CryptoError, ENC_PREFIX, decryptField, encryptField } from '@life/crypto';
import { Note } from './note.entity';
import { NoteTag } from './note-tag.entity';
import { DEFAULT_PAGE_LIMIT, KeysService, paginate, runAtomicBatch } from '@life/service-kit';
import { NOTES_CACHE, NotesCache } from './notes-cache';
import { likeMatch } from './content-match';
import { decodeTagUsage, normalizeTagIds } from '@life/shared';
import type { Note as NoteDto, NotePage, TagUsage } from '@life/shared';

/** A note as a write carries it — the shape a batch item holds, per item. */
type NoteDraft = { body: string; tagIds?: number[] };
type NotePatch = { body?: string; tagIds?: number[]; expectedVersion?: number };

/** One write's repositories: the transaction's when a batch supplies its manager. */
interface WriteRepositories {
  notes: Repository<Note>;
  noteTags: Repository<NoteTag>;
}

/**
 * AAD for a note body (`SPEC-notes-at-rest` Encryption Rules). Byte-exact and
 * uniform: the identical string must be reconstructed at encrypt and decrypt, so
 * the note `id` is service-generated (`randomUUID`) and set on the entity before
 * insert.
 */
function noteBodyAad(ownerSub: string, noteId: string): string {
  return `life.v1|${ownerSub}|note|body|${noteId}`;
}

/**
 * Ciphertext-row shapes stored in Redis (`SPEC-notes-at-rest` Cache Rules). The
 * cache holds **rows as stored** — `body` is an `enc.v1.` envelope — never a
 * decrypted DTO. `tagIds` are association ids (metadata) copied verbatim so the
 * DTO and the in-memory tag filter can run after a hit.
 */
interface CachedNoteRow {
  id: string;
  ownerSub: string | null;
  body: string;
  version: number;
  createdAt: string;
  contentUpdatedAt: string | null;
  updatedAt: string;
  deletedAt: string | null;
  tagIds: number[];
}

/** Serialize a note entity into its ciphertext-row form (dates → ISO). */
function toCachedNoteRow(note: Note): CachedNoteRow {
  return {
    id: note.id,
    ownerSub: note.ownerSub,
    body: note.body,
    version: note.version,
    createdAt: note.createdAt.toISOString(),
    contentUpdatedAt: note.contentUpdatedAt ? note.contentUpdatedAt.toISOString() : null,
    updatedAt: note.updatedAt.toISOString(),
    deletedAt: note.deletedAt ? note.deletedAt.toISOString() : null,
    tagIds: (note.noteTags ?? []).map((nt) => nt.tagId).sort((a, b) => a - b),
  };
}

/**
 * True when the serialized row's content field is an `enc.v1.` envelope, so the
 * populate may touch Redis. A pre-backfill legacy row is plaintext (D8
 * dual-read); caching it would persist plaintext in an AOF store, so it refuses
 * (`cacheable` on `getThrough`) and is served straight from the DB instead.
 * `tagIds` are plain integers (association metadata) and carry no content.
 */
function isCiphertextNoteRow(row: CachedNoteRow): boolean {
  return typeof row?.body === 'string' && row.body.startsWith(ENC_PREFIX);
}

/** Reject a hit whose serialized row is not `enc.v1.` ciphertext content. */
function decodeCiphertextNoteRow(raw: unknown): CachedNoteRow {
  const row = raw as CachedNoteRow;
  if (!isCiphertextNoteRow(row)) throw new Error('cache entry is not ciphertext');
  return withContentUpdatedAtResolved(row);
}

function decodeCiphertextNoteList(raw: unknown): CachedNoteRow[] {
  if (!Array.isArray(raw) || !raw.every(isCiphertextNoteRow)) {
    throw new Error('cache entry is not ciphertext');
  }
  return raw.map(withContentUpdatedAtResolved);
}

/**
 * A pre-deploy Redis entry predates the `contentUpdatedAt` field. Its absent
 * timestamp reads as `null` — the same value a NULL column carries — so every
 * read path resolves it to `createdAt` rather than tripping on `undefined`.
 */
function withContentUpdatedAtResolved(row: CachedNoteRow): CachedNoteRow {
  return { ...row, contentUpdatedAt: row.contentUpdatedAt ?? null };
}

/**
 * Rehydrate a validated ciphertext row. Content is run through the same AAD
 * shape as a fresh DB read, so a hit cannot skip authentication. Callers pass
 * rows that already passed `isCiphertextNoteRow` (loader output or a decoded hit).
 */
function decodeCachedNoteRow(
  row: CachedNoteRow,
  sub: string,
  dek: Buffer | null,
  open: OpenField,
): NoteDto {
  return {
    id: row.id,
    body: open(row.body, dek, noteBodyAad(sub, row.id), row.id),
    tagIds: [...row.tagIds],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    version: row.version,
  };
}

/** Binds `openField` for decode helpers (keeps the private method off the free functions). */
type OpenField = (stored: string, dek: Buffer | null, aad: string, id: string) => string;

/**
 * A decoded note beside the timestamp that ranks it in the list. The wire DTO is
 * frozen, so the ranking key travels outside it rather than on it; `id` is
 * repeated here because the keyset cursor keys on it.
 */
interface RankedNote {
  id: string;
  listTimestamp: string;
  note: NoteDto;
}

/**
 * The list ranking key: a body-edit time when the row carries one, else the
 * note's birth time. A pre-backfill row has neither a backfilled nor an edited
 * `contentUpdatedAt`, so it ranks exactly where `createdAt` put it today.
 */
function listTimestampOf(row: CachedNoteRow): string {
  return row.contentUpdatedAt ?? row.createdAt;
}

/** Newest content edit first; `id DESC` breaks a tie (`id`s are uuids). */
function newestContentFirst(a: RankedNote, b: RankedNote): number {
  return b.listTimestamp.localeCompare(a.listTimestamp) || b.id.localeCompare(a.id);
}

/**
 * The list's strictly-after test: `timestamp DESC, id DESC`, compared on the
 * hydrated ISO timestamp. sqlite stores `YYYY-MM-DD HH:MM:SS.mmm` while the
 * cursor is ISO `...T...Z`; the old SQL predicate compared the two directly and
 * re-emitted the cursor row at a tie. Comparing in memory on one clock is what
 * makes the boundary exact.
 */
function afterListPosition(row: RankedNote, at: string[]): boolean {
  const [timestamp, id] = at;
  return row.listTimestamp < timestamp || (row.listTimestamp === timestamp && row.id < id);
}

/** True when a note passes the list's tag and text filters. */
function matchesListRequest(note: NoteDto, filters: { tagId?: number; q?: string }): boolean {
  if (filters.tagId !== undefined && !note.tagIds.includes(filters.tagId)) return false;
  if (filters.q && !likeMatch(note.body, `%${filters.q}%`)) return false;
  return true;
}

@Injectable()
export class NotesService {
  private readonly logger = new Logger(NotesService.name);

  /**
   * `openField` passed as a decrypt callback must stay `this`-bound: its catch
   * path logs through `this.logger`, and an unbound reference turns that into a
   * TypeError that would mask the real `CryptoError` on tampered rows.
   */
  private readonly openFieldCb = this.openField.bind(this);

  constructor(
    @InjectRepository(Note) private readonly notes: Repository<Note>,
    @InjectRepository(NoteTag) private readonly noteTags: Repository<NoteTag>,
    @Inject(NOTES_CACHE) private readonly cache: NotesCache,
    // Nest injects this by type once `NotesModule` imports `KeysModule`. Optional
    // only so a legacy 3-arg construction stays compiling; Nest still requires
    // the provider at runtime, so production can never boot without DEK custody.
    private readonly keys?: KeysService,
  ) {}

  /** The owner-key service; always present under Nest DI (see constructor note). */
  private requireKeys(): KeysService {
    if (!this.keys) {
      throw new CryptoError('KeysService is unavailable: DEK custody is not wired');
    }
    return this.keys;
  }

  /**
   * Decrypt-or-passthrough for a stored content field. A stored value carrying
   * the `enc.v1.` prefix is decrypted (and authenticated) against its AAD;
   * anything else is a legacy plaintext row and passes through unchanged
   * (dual-read, rollback-safe). A decrypt failure is fail-closed: one ids-only
   * log line, then the typed `CryptoError` is rethrown — never empty/garbage.
   */
  private openField(stored: string, dek: Buffer | null, aad: string, id: string): string {
    if (!stored.startsWith(ENC_PREFIX)) return stored;
    if (!dek) {
      // Callers only reach here after proving a key was required; failing closed
      // beats ever returning ciphertext to the API.
      throw new CryptoError('missing data key for an encrypted field');
    }
    try {
      return decryptField(dek, stored, aad);
    } catch (err) {
      // Ids only — never content, keys, or AAD.
      this.logger.error(`decrypt failed for note ${id}`);
      throw err;
    }
  }

  /**
   * Resolve the owner DEK for a set of ciphertext rows, at most once per read.
   * A set with no `enc.v1.` body is all-legacy (or empty), so no key is needed
   * and the rows pass through `openField` untouched (dual-read).
   */
  private readDek(sub: string, rows: CachedNoteRow[]): Promise<Buffer | null> {
    const needs = rows.some((r) => r.body.startsWith(ENC_PREFIX));
    if (!needs) return Promise.resolve(null);
    return this.requireKeys().getDekForRead(sub);
  }

  /** Assemble the wire DTO from a stored note plus its association ids. */
  private noteDto(note: Note, tagIds: number[], sub: string, dek: Buffer | null): NoteDto {
    return {
      id: note.id,
      body: this.openField(note.body, dek, noteBodyAad(sub, note.id), note.id),
      tagIds: [...tagIds],
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
      deletedAt: note.deletedAt ? note.deletedAt.toISOString() : null,
      version: note.version,
    };
  }

  /**
   * Decrypt a single loaded note, provisioning nothing (read path, fail-closed).
   * Runs the stored row through the same ciphertext-row pipeline a cache hit
   * uses, so there is exactly one decrypt/assemble path.
   */
  private async decryptOne(note: Note, sub: string): Promise<NoteDto> {
    const row = toCachedNoteRow(note);
    const dek = await this.readDek(sub, [row]);
    return decodeCachedNoteRow(row, sub, dek, this.openFieldCb);
  }

  async create(sub: string, body: string, tagIds: number[] | undefined): Promise<NoteDto> {
    const note = await this.insertOne(this.notes.manager, sub, { body, tagIds });
    // Bump AFTER the insert: pre-mutation reads were born under the old
    // generation and die here. A thrown insert never bumps (cache stays honest).
    await this.cache.bumpGeneration(sub);
    return note;
  }

  /**
   * The `notes` batch create: one transaction, submission order, one bump
   * (`SPEC-note-service.md` §6). The kernel owns all three, so this contributes
   * only the per-item work.
   */
  async createMany(sub: string, items: NoteDraft[]): Promise<NoteDto[]> {
    return runAtomicBatch({
      items,
      sub,
      dataSource: this.writeDataSource,
      cache: this.cache,
      runItem: (item, manager) => this.insertOne(manager, sub, item),
    });
  }

  /**
   * One note's insert, through the manager the caller supplies, and with no bump.
   * The singular route passes the repository's manager and keeps its own bump; a
   * batch passes the transaction's manager, so the kernel owns one bump for the
   * whole request.
   */
  private async insertOne(
    manager: EntityManager | undefined,
    sub: string,
    draft: NoteDraft,
  ): Promise<NoteDto> {
    const { notes, noteTags } = this.writeRepositories(manager);
    // Service-generated id: AAD binds it, so it must exist before the ciphertext.
    const id = randomUUID();
    const ids = normalizeTagIds(draft.tagIds);
    const dek = await this.requireKeys().getOrCreateDek(sub);
    const note = notes.create({
      id,
      body: encryptField(dek, draft.body, noteBodyAad(sub, id)),
      ownerSub: sub,
      version: 0,
      deletedAt: null,
      contentUpdatedAt: new Date(),
    });
    const saved = await notes.save(note);
    // Association rows are managed explicitly (TagRef joins, not a cascade
    // relation) so a write stores exactly the ids it carries.
    if (ids.length > 0) {
      await noteTags.insert(ids.map((tagId) => ({ noteId: id, tagId })));
    }
    return this.noteDto(saved, ids, sub, dek);
  }

  /**
   * The repositories one write runs against. A manager means "inside this
   * transaction", and every write a batch performs must go through it. No
   * manager means the service's own repositories — the singular path, and the
   * only shape a unit suite's repository double can supply.
   */
  private writeRepositories(manager: EntityManager | undefined): WriteRepositories {
    if (!manager) return { notes: this.notes, noteTags: this.noteTags };
    return { notes: manager.getRepository(Note), noteTags: manager.getRepository(NoteTag) };
  }

  /**
   * The datasource a batch opens its one transaction on (same DB as the writes).
   *
   * ponytail: taken from the injected repository rather than a fourth
   * constructor argument, so the three existing suites that build this service
   * positionally keep compiling. Upgrade path: `@InjectDataSource()` once those
   * suites are converted to a Nest testing module.
   */
  private get writeDataSource() {
    return this.notes.manager.connection;
  }

  async findAll(
    sub: string,
    opts: {
      tagId?: number;
      q?: string;
      limit?: number;
      cursor?: string;
    },
  ): Promise<NotePage> {
    const limit = opts.limit ?? DEFAULT_PAGE_LIMIT;
    // Key: `note:<sub>:v<gen>:list` — no q/tagId/limit/cursor. The cached value
    // is the whole non-trashed ciphertext row set; every filter variant shares it.
    const rows = await this.cache.getThrough(
      sub,
      'note:list',
      async () => {
        // Metadata-only SQL: content (`q`) is an envelope, so it cannot be
        // matched in the DB, and the tag filter is applied in memory so one
        // cached row set serves every variant. Matching, ranking, and
        // pagination all run in memory after decryption, so the SQL order only
        // keeps the cached row set stable; it is not the list contract.
        const found = await this.notes
          .createQueryBuilder('note')
          .leftJoinAndSelect('note.noteTags', 'noteTag')
          .orderBy('note.createdAt', 'DESC')
          .addOrderBy('note.id', 'DESC')
          .where('note.deletedAt IS NULL')
          .andWhere('note.ownerSub = :sub', { sub })
          .getMany();
        return found.map(toCachedNoteRow);
      },
      // A legacy plaintext row must never be cached (AOF persists it).
      { decode: decodeCiphertextNoteList, cacheable: (rows) => rows.every(isCiphertextNoteRow) },
    );

    const dek = await this.readDek(sub, rows);
    const ranked = rows.map((row) => ({
      id: row.id,
      listTimestamp: listTimestampOf(row),
      note: decodeCachedNoteRow(row, sub, dek, this.openFieldCb),
    }));

    const matching = ranked
      .filter(({ note }) => matchesListRequest(note, opts))
      .sort(newestContentFirst);

    const { rows: page, nextCursor } = paginate(matching, {
      limit,
      cursor: opts.cursor,
      keyOf: (entry) => [entry.listTimestamp, entry.id],
      after: afterListPosition,
    });
    return { notes: page.map((entry) => entry.note), nextCursor };
  }

  async findTrash(
    sub: string,
    opts: { limit?: number; cursor?: string },
  ): Promise<NotePage> {
    const limit = opts.limit ?? DEFAULT_PAGE_LIMIT;
    // Key: `note:<sub>:v<gen>:trash` — pagination is in memory, so limit/cursor
    // are not part of the key and one entry serves every trash page request.
    const rows = await this.cache.getThrough(
      sub,
      'note:trash',
      async () => {
        // Metadata-only SQL mirroring `findAll`: trashed rows only, in today's
        // `deletedAt DESC` / `id` DESC order, then keyset-paginated in memory so a
        // same-timestamp tie can never repeat or skip the boundary row.
        const found = await this.notes
          .createQueryBuilder('note')
          .leftJoinAndSelect('note.noteTags', 'noteTag')
          .where('note.deletedAt IS NOT NULL')
          .andWhere('note.ownerSub = :sub', { sub })
          .orderBy('note.deletedAt', 'DESC')
          .addOrderBy('note.id', 'DESC')
          .getMany();
        return found.map(toCachedNoteRow);
      },
      { decode: decodeCiphertextNoteList, cacheable: (rows) => rows.every(isCiphertextNoteRow) },
    );

    const dek = await this.readDek(sub, rows);
    const decoded = rows.map((row) => decodeCachedNoteRow(row, sub, dek, this.openFieldCb));
    // Trash shares the list's ranking shape, `deletedAt DESC, id DESC`; ranking on
    // the hydrated timestamp is what keeps a same-instant tie off the boundary.
    const positioned = decoded.map((note) => ({
      id: note.id,
      listTimestamp: note.deletedAt!,
      note,
    }));
    const { rows: page, nextCursor } = paginate(positioned, {
      limit,
      cursor: opts.cursor,
      keyOf: (entry) => [entry.listTimestamp, entry.id],
      after: afterListPosition,
    });
    return { notes: page.map((entry) => entry.note), nextCursor };
  }

  async findOne(sub: string, id: string): Promise<NoteDto> {
    // Key: `note:<sub>:v<gen>:one:<id>` — a single ciphertext row, not a DTO.
    const row = await this.cache.getThrough(
      sub,
      `note:one:${id}`,
      async () => {
        const note = await this.notes.findOne({
          where: { id, ownerSub: sub, deletedAt: IsNull() },
          relations: { noteTags: true },
        });
        if (!note) throw new NotFoundException('Note not found');
        return toCachedNoteRow(note);
      },
      { decode: decodeCiphertextNoteRow, cacheable: isCiphertextNoteRow },
    );
    const dek = await this.readDek(sub, [row]);
    return decodeCachedNoteRow(row, sub, dek, this.openFieldCb);
  }

  async update(
    sub: string,
    id: string,
    body?: string,
    tagIds?: number[],
    expectedVersion?: number,
  ): Promise<NoteDto> {
    const note = await this.updateOne(this.notes.manager, sub, id, {
      body,
      tagIds,
      expectedVersion,
    });
    // Bump AFTER the mutation — see bumpGeneration(); a 409 never bumps.
    await this.cache.bumpGeneration(sub);
    return note;
  }

  /** The `notes` batch update: one transaction, submission order, one bump. */
  async updateMany(
    sub: string,
    items: (NotePatch & { id: string })[],
  ): Promise<NoteDto[]> {
    return runAtomicBatch({
      items,
      sub,
      dataSource: this.writeDataSource,
      cache: this.cache,
      runItem: (item, manager) => this.updateOne(manager, sub, item.id, item),
    });
  }

  /**
   * One note's patch (plus its association rows), through the caller's manager,
   * and with no bump. Optimistic concurrency is unchanged: a stale
   * `expectedVersion` is a `409` and writes nothing, which for a batch means the
   * whole request rolls back.
   */
  private async updateOne(
    manager: EntityManager | undefined,
    sub: string,
    id: string,
    patch: NotePatch,
  ): Promise<NoteDto> {
    const { notes, noteTags } = this.writeRepositories(manager);
    // Load WITHOUT the relation: associations are managed explicitly below, and
    // leaving `noteTags` undefined keeps `save` from touching any join row (the
    // owning side would otherwise try to write a stale join column).
    const note = await notes.findOne({
      where: { id, ownerSub: sub, deletedAt: IsNull() },
    });
    if (!note) throw new NotFoundException('Note not found');
    if (patch.expectedVersion !== undefined && note.version !== patch.expectedVersion) {
      throw new ConflictException('Note was modified');
    }
    // Write path: always envelopes. Re-encrypting with a fresh nonce is correct
    // even when the plaintext is unchanged.
    const dek = await this.requireKeys().getOrCreateDek(sub);
    if (patch.body !== undefined) {
      note.body = encryptField(dek, patch.body, noteBodyAad(sub, note.id));
      note.contentUpdatedAt = new Date();
    }

    let currentIds: number[];
    if (patch.tagIds !== undefined) {
      // Updates REPLACE the association set: the ids the write carries are what
      // remains, so dangling ids fall away (kernel detach semantics; no registry
      // validation, no prune pass).
      const ids = normalizeTagIds(patch.tagIds);
      await noteTags.delete({ noteId: note.id });
      if (ids.length > 0) {
        await noteTags.insert(ids.map((tagId) => ({ noteId: note.id, tagId })));
      }
      currentIds = ids;
    } else {
      currentIds = (await noteTags.find({ where: { noteId: note.id } }))
        .map((noteTag) => noteTag.tagId)
        .sort((a, b) => a - b);
    }

    note.version += 1;
    const saved = await notes.save(note);
    return this.noteDto(saved, currentIds, sub, dek);
  }

  async remove(sub: string, id: string): Promise<void> {
    await this.softDeleteOne(this.notes.manager, sub, id);
    // Bump AFTER the mutation: pre-mutation entries die here.
    await this.cache.bumpGeneration(sub);
  }

  /**
   * The `notes` batch delete: one transaction, submission order, one bump, and
   * the singular route's soft-delete meaning — the ids come back for per-item
   * confirmation without a partial-success envelope.
   */
  async removeMany(sub: string, items: { id: string }[]): Promise<{ deleted: string[] }> {
    const deleted = await runAtomicBatch({
      items,
      sub,
      dataSource: this.writeDataSource,
      cache: this.cache,
      runItem: async (item, manager) => {
        await this.softDeleteOne(manager, sub, item.id);
        return item.id;
      },
    });
    return { deleted };
  }

  /**
   * One note's move to trash, through the caller's manager, and with no bump.
   * Soft by definition — `deletedAt` is set and `version` is untouched — so a
   * batch delete means exactly what the singular delete means and the note stays
   * restorable.
   */
  private async softDeleteOne(
    manager: EntityManager | undefined,
    sub: string,
    id: string,
  ): Promise<void> {
    const { notes } = this.writeRepositories(manager);
    const note = await notes.findOne({ where: { id, ownerSub: sub, deletedAt: IsNull() } });
    if (!note) throw new NotFoundException('Note not found');
    note.deletedAt = new Date();
    await notes.save(note);
  }

  async restore(sub: string, id: string): Promise<NoteDto> {
    const note = await this.notes.findOne({
      where: { id, ownerSub: sub, deletedAt: Not(IsNull()) },
      relations: { noteTags: true },
    });
    if (!note) throw new NotFoundException('Note not found');
    note.deletedAt = null;
    const saved = await this.notes.save(note);
    await this.cache.bumpGeneration(sub);
    return this.decryptOne(saved, sub);
  }

  async removePermanent(sub: string, id: string): Promise<void> {
    // The `noteId` FK (`ON DELETE CASCADE`) removes the note's association rows.
    const result = await this.notes.delete({ id, ownerSub: sub, deletedAt: Not(IsNull()) });
    if (!result.affected) throw new NotFoundException('Note not found');
    // Only a successful delete reaches the bump.
    await this.cache.bumpGeneration(sub);
  }

  async emptyTrash(sub: string): Promise<{ count: number }> {
    const result = await this.notes.delete({ ownerSub: sub, deletedAt: Not(IsNull()) });
    await this.cache.bumpGeneration(sub);
    return { count: result.affected ?? 0 };
  }

  /**
   * The owner's tag usage surface (kernel `GET …/tags → [{tagId, count}]`):
   * association ids + how many non-trashed notes carry each. Ids and counts only
   * — names live in `tags-service` (resolved by the BFF), so nothing here is
   * content and the `note:tags` cache is metadata-only by design.
   */
  async listTagUsage(sub: string): Promise<TagUsage[]> {
    // Key: `note:<sub>:v<gen>:tags` — the owner's used-id+count rows.
    const rows = await this.cache.getThrough(
      sub,
      'note:tags',
      async () => {
        // Metadata-only SQL: count non-trashed notes per association id for this
        // owner (trashed-only tags stay hidden, as before).
        const raw = (await this.noteTags
          .createQueryBuilder('noteTag')
          .innerJoin('noteTag.note', 'note')
          .select('noteTag.tagId', 'tagId')
          .addSelect('COUNT(*)', 'count')
          .where('note.deletedAt IS NULL')
          .andWhere('note.ownerSub = :sub', { sub })
          .groupBy('noteTag.tagId')
          .orderBy('noteTag.tagId', 'ASC')
          .getRawMany()) as Array<{ tagId: number | string; count: number | string }>;
        return raw.map((row) => ({ tagId: Number(row.tagId), count: Number(row.count) }));
      },
      { decode: decodeTagUsage },
    );
    return rows;
  }
}
