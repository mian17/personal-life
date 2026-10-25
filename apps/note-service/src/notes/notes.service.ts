import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { IsNull, Not, Repository } from 'typeorm';
import { CryptoError, ENC_PREFIX, decryptField, encryptField } from '@life/crypto';
import { Note } from './note.entity';
import { NoteTag } from './note-tag.entity';
import { KeysService } from '../keys/keys.service';
import { NOTES_CACHE, NotesCache } from './notes-cache';
import { likeMatch } from './content-match';
import type { Note as NoteDto, NotePage, TagUsage } from '@life/shared';

/**
 * Deduplicate the `tagIds` a write carries, preserving first-seen order. The
 * result is the association set stored for the note (TagRef semantics,
 * `SPEC-service-kernel`): note-service stores exactly the ids it is given —
 * no registry validation, no name resolution (names live in `tags-service`).
 */
function normalizeTagIds(tagIds: number[] | undefined): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of tagIds ?? []) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.sort((a, b) => a - b);
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
 * The `note:tags` cache holds **metadata only** (`SPEC-tags-extraction` Cache
 * Rules): the used-`tagId`+count rows, which carry no plaintext. A hit is valid
 * when every row has numeric `tagId`/`count` fields.
 */
function isTagUsageRow(row: TagUsage): boolean {
  return (
    typeof row?.tagId === 'number' &&
    Number.isInteger(row.tagId) &&
    typeof row?.count === 'number' &&
    Number.isInteger(row.count) &&
    row.count >= 0
  );
}

function decodeTagUsage(raw: unknown): TagUsage[] {
  if (!Array.isArray(raw) || !raw.every(isTagUsageRow)) {
    throw new Error('cache entry is not tag usage');
  }
  return raw.map((row) => ({ tagId: row.tagId, count: row.count }));
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
 * Decode today's keyset cursor, `base64(<isoTimestamp>|<id>)`. The wire format is
 * unchanged; only the comparison moved in memory (see `paginate`).
 */
function decodeCursor(cursor: string): { ts: string; id: string } {
  const [ts, id] = Buffer.from(cursor, 'base64').toString().split('|');
  return { ts, id };
}

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

/** True when a note passes the list's tag and text filters. */
function matchesListRequest(note: NoteDto, filters: { tagId?: number; q?: string }): boolean {
  if (filters.tagId !== undefined && !note.tagIds.includes(filters.tagId)) return false;
  if (filters.q && !likeMatch(note.body, `%${filters.q}%`)) return false;
  return true;
}

/**
 * In-memory keyset pagination over a candidate list already ordered by
 * (`timestamp DESC`, `id DESC`) — the list's exact order. Rows are kept only when
 * they fall strictly after the cursor
 * (`timestamp < cursor.ts OR (timestamp = cursor.ts AND id < cursor.id)`), so a
 * page boundary can neither repeat nor skip a row.
 *
 * The comparison runs on the hydrated ISO timestamp, not raw sqlite text: sqlite
 * stores `YYYY-MM-DD HH:MM:SS.mmm` while the cursor is ISO `...T...Z`, and the
 * old SQL predicate compared the two directly — at a tie it re-emitted the
 * cursor row. Moving pagination in memory (the filter now runs post-decrypt)
 * fixes that, which the no-duplicates/no-skips contract requires.
 *
 * Cursor wire format (`base64(<isoTimestamp>|<id>)`) and the page shape are
 * unchanged from the SQL path.
 */
function paginate<T extends { id: string }>(
  ordered: T[],
  limit: number,
  cursor: string | undefined,
  timestampOf: (item: T) => string,
): { page: T[]; nextCursor: string | null } {
  let items = ordered;
  if (cursor) {
    const { ts, id } = decodeCursor(cursor);
    items = ordered.filter((item) => {
      const itemTs = timestampOf(item);
      return itemTs < ts || (itemTs === ts && item.id < id);
    });
  }
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const last = page.at(-1);
  const nextCursor =
    hasMore && last ? Buffer.from(`${timestampOf(last)}|${last.id}`).toString('base64') : null;
  return { page, nextCursor };
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
  private async readDek(sub: string, rows: CachedNoteRow[]): Promise<Buffer | null> {
    const needs = rows.some((r) => r.body.startsWith(ENC_PREFIX));
    if (!needs) return null;
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
    // Service-generated id: AAD binds it, so it must exist before the ciphertext.
    const id = randomUUID();
    const ids = normalizeTagIds(tagIds);
    const dek = await this.requireKeys().getOrCreateDek(sub);
    const note = this.notes.create({
      id,
      body: encryptField(dek, body, noteBodyAad(sub, id)),
      ownerSub: sub,
      version: 0,
      deletedAt: null,
      contentUpdatedAt: new Date(),
    });
    const saved = await this.notes.save(note);
    // Association rows are managed explicitly (TagRef joins, not a cascade
    // relation) so a write stores exactly the ids it carries.
    if (ids.length > 0) {
      await this.noteTags.insert(ids.map((tagId) => ({ noteId: id, tagId })));
    }
    // Bump AFTER the insert: pre-mutation reads were born under the old
    // generation and die here. A thrown save never bumps (cache stays honest).
    await this.cache.bumpGeneration(sub);
    return this.noteDto(saved, ids, sub, dek);
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
    const limit = opts.limit ?? 50;
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

    const { page, nextCursor } = paginate(
      matching,
      limit,
      opts.cursor,
      (entry) => entry.listTimestamp,
    );
    return { notes: page.map((entry) => entry.note), nextCursor };
  }

  async findTrash(
    sub: string,
    opts: { limit?: number; cursor?: string },
  ): Promise<NotePage> {
    const limit = opts.limit ?? 50;
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
    const { page, nextCursor } = paginate(decoded, limit, opts.cursor, (n) => n.deletedAt!);
    return { notes: page, nextCursor };
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
    // Load WITHOUT the relation: associations are managed explicitly below, and
    // leaving `noteTags` undefined keeps `save` from touching any join row (the
    // owning side would otherwise try to write a stale join column).
    const note = await this.notes.findOne({
      where: { id, ownerSub: sub, deletedAt: IsNull() },
    });
    if (!note) throw new NotFoundException('Note not found');
    if (expectedVersion !== undefined && note.version !== expectedVersion) {
      throw new ConflictException('Note was modified');
    }
    // Write path: always envelopes. Re-encrypting with a fresh nonce is correct
    // even when the plaintext is unchanged.
    const dek = await this.requireKeys().getOrCreateDek(sub);
    if (body !== undefined) {
      note.body = encryptField(dek, body, noteBodyAad(sub, note.id));
      note.contentUpdatedAt = new Date();
    }

    let currentIds: number[];
    if (tagIds !== undefined) {
      // Updates REPLACE the association set: the ids the write carries are what
      // remains, so dangling ids fall away (kernel detach semantics; no registry
      // validation, no prune pass).
      const ids = normalizeTagIds(tagIds);
      await this.noteTags.delete({ noteId: note.id });
      if (ids.length > 0) {
        await this.noteTags.insert(ids.map((tagId) => ({ noteId: note.id, tagId })));
      }
      currentIds = ids;
    } else {
      currentIds = (await this.noteTags.find({ where: { noteId: note.id } }))
        .map((nt) => nt.tagId)
        .sort((a, b) => a - b);
    }

    note.version += 1;
    const saved = await this.notes.save(note);
    // Bump AFTER the mutation — see bumpGeneration(); a 409 above never bumps.
    await this.cache.bumpGeneration(sub);
    return this.noteDto(saved, currentIds, sub, dek);
  }

  async remove(sub: string, id: string): Promise<void> {
    const note = await this.notes.findOne({ where: { id, ownerSub: sub, deletedAt: IsNull() } });
    if (!note) throw new NotFoundException('Note not found');
    note.deletedAt = new Date();
    await this.notes.save(note);
    // Bump AFTER the mutation: pre-mutation entries die here.
    await this.cache.bumpGeneration(sub);
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
