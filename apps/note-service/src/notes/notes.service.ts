import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { IsNull, Not, Repository } from 'typeorm';
import { CryptoError, ENC_PREFIX, decryptField, encryptField } from '@life/crypto';
import { Note } from './note.entity';
import { Tag } from './tag.entity';
import { KeysService } from '../keys/keys.service';
import { hashOptions, NOTES_CACHE, NotesCache } from './notes-cache';
import { likeMatch } from './content-match';
import type { Note as NoteDto, NotePage } from '@life/shared';

function normalizeTags(tags: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags ?? []) {
    const name = raw.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
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

/** AAD for a tag name. Tag ids are DB-assigned post-insert, so they cannot bind. */
function tagNameAad(ownerSub: string): string {
  return `life.v1|${ownerSub}|tag|name`;
}

/**
 * Decode today's keyset cursor, `base64(<isoTimestamp>|<id>)`. The wire format is
 * unchanged; only the comparison moved in memory (see `paginate`).
 */
function decodeCursor(cursor: string): { ts: string; id: string } {
  const [ts, id] = Buffer.from(cursor, 'base64').toString().split('|');
  return { ts, id };
}

/**
 * In-memory keyset pagination over a candidate list already ordered by
 * (`timestamp DESC`, `id DESC`) — today's exact order. Rows are kept only when
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
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? Buffer.from(`${timestampOf(last)}|${last.id}`).toString('base64') : null;
  return { page, nextCursor };
}

@Injectable()
export class NotesService {
  private readonly logger = new Logger(NotesService.name);

  constructor(
    @InjectRepository(Note) private readonly notes: Repository<Note>,
    @InjectRepository(Tag) private readonly tags: Repository<Tag>,
    @Inject(NOTES_CACHE) private readonly cache: NotesCache,
    // Nest injects this by type once `NotesModule` imports `KeysModule` (T7
    // integration). Optional-typed only so the legacy 3-arg construction in the
    // T5-owned cache spec keeps compiling; Nest still requires the provider at
    // runtime, so production can never silently boot without DEK custody.
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
   * Decrypt-or-passthrough for a single stored content field. A stored value
   * carrying the `enc.v1.` prefix is decrypted (and authenticated) against its
   * AAD; anything else is a legacy plaintext row and passes through unchanged
   * (dual-read, rollback-safe). A decrypt failure is fail-closed: one ids-only
   * log line, then the typed `CryptoError` is rethrown — never empty/garbage.
   */
  private openField(
    stored: string,
    dek: Buffer | null,
    aad: string,
    entity: 'note' | 'tag',
    id: string,
  ): string {
    if (!stored.startsWith(ENC_PREFIX)) return stored;
    if (!dek) {
      // Callers only reach here after proving a key was required; failing closed
      // beats ever returning ciphertext to the API.
      throw new CryptoError('missing data key for an encrypted field');
    }
    try {
      return decryptField(dek, stored, aad);
    } catch (err) {
      // Ids only — never content, tag names, keys, or AAD.
      this.logger.error(`decrypt failed for ${entity} ${id}`);
      throw err;
    }
  }

  /** True when any content field of `note` is an envelope needing the owner DEK. */
  private needsDek(note: Note): boolean {
    return (
      note.body.startsWith(ENC_PREFIX) ||
      (note.tags ?? []).some((t) => t.name.startsWith(ENC_PREFIX))
    );
  }

  private toDto(note: Note, sub: string, dek: Buffer | null): NoteDto {
    return {
      id: note.id,
      body: this.openField(note.body, dek, noteBodyAad(sub, note.id), 'note', note.id),
      tags: (note.tags ?? []).map((t) => ({
        id: t.id,
        name: this.openField(t.name, dek, tagNameAad(sub), 'tag', String(t.id)),
      })),
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
      deletedAt: note.deletedAt ? note.deletedAt.toISOString() : null,
      version: note.version,
    };
  }

  /** Decrypt a single loaded note, provisioning nothing (read path, fail-closed). */
  private async decryptOne(note: Note, sub: string): Promise<NoteDto> {
    const dek = this.needsDek(note) ? await this.requireKeys().getDekForRead(sub) : null;
    return this.toDto(note, sub, dek);
  }

  /** Decrypt a page of loaded notes, resolving the owner DEK at most once. */
  private async decryptMany(rows: Note[], sub: string): Promise<NoteDto[]> {
    const dek = rows.some((n) => this.needsDek(n))
      ? await this.requireKeys().getDekForRead(sub)
      : null;
    return rows.map((n) => this.toDto(n, sub, dek));
  }

  /**
   * Resolve tag names to rows for one owner. Names are encrypted at rest, so the
   * caller's rows are loaded and their names decrypted in memory; matching is
   * case-insensitive and a match **reuses** the existing row (the dropped
   * `UQ_tag_name_owner` invariant, relocated to service enforcement). A brand-new
   * name is encrypted with the tag AAD before insert.
   */
  private async resolveTags(sub: string, names: string[], dek: Buffer): Promise<Tag[]> {
    if (names.length === 0) return [];
    const existing = await this.tags.find({ where: { ownerSub: sub } });
    const byKey = new Map<string, Tag>();
    for (const tag of existing) {
      const name = this.openField(tag.name, dek, tagNameAad(sub), 'tag', String(tag.id));
      byKey.set(name.toLowerCase(), tag);
    }
    const result: Tag[] = [];
    for (const name of names) {
      const key = name.toLowerCase();
      let tag = byKey.get(key);
      if (!tag) {
        tag = await this.tags.save(
          this.tags.create({ name: encryptField(dek, name, tagNameAad(sub)), ownerSub: sub }),
        );
        byKey.set(key, tag);
      }
      result.push(tag);
    }
    return result;
  }

  async create(sub: string, body: string, tagNames: string[] | undefined): Promise<NoteDto> {
    // Service-generated id: AAD binds it, so it must exist before the ciphertext.
    const id = randomUUID();
    const dek = await this.requireKeys().getOrCreateDek(sub);
    const note = this.notes.create({
      id,
      body: encryptField(dek, body, noteBodyAad(sub, id)),
      ownerSub: sub,
      version: 0,
      deletedAt: null,
      tags: await this.resolveTags(sub, normalizeTags(tagNames), dek),
    });
    const saved = await this.notes.save(note);
    // Bump AFTER the insert: pre-mutation reads were born under the old
    // generation and die here. A thrown save never bumps (cache stays honest).
    await this.cache.bumpGeneration(sub);
    return this.toDto(saved, sub, dek);
  }

  async findAll(
    sub: string,
    opts: {
      tag?: string;
      q?: string;
      limit?: number;
      cursor?: string;
    },
  ): Promise<NotePage> {
    const limit = opts.limit ?? 50;
    const cacheKey = `note:list:${hashOptions({
      tag: opts.tag,
      q: opts.q,
      limit: opts.limit,
      cursor: opts.cursor,
    })}`;
    return this.cache.getThrough(sub, cacheKey, async () => {
      // Metadata-only SQL: content (`q`) and tag names are envelopes, so neither
      // can be matched in the DB. Fetch the owner's non-trashed rows in today's
      // exact order (`createdAt DESC`, `id` DESC tie-break) and do all matching
      // and pagination in memory after decryption. No `LIMIT` can be pushed into
      // SQL because the row set is only known once the filter has run.
      const rows = await this.notes
        .createQueryBuilder('note')
        .leftJoinAndSelect('note.tags', 'tag')
        .orderBy('note.createdAt', 'DESC')
        .addOrderBy('note.id', 'DESC')
        .where('note.deletedAt IS NULL')
        .andWhere('note.ownerSub = :sub', { sub })
        .getMany();

      // Decrypt once for the whole candidate set; matching sees effective
      // plaintext (envelope rows: decrypted; legacy rows: the raw value).
      const decoded = await this.decryptMany(rows, sub);

      const tagKey = opts.tag?.toLowerCase();
      const filtered = decoded.filter((note) => {
        if (tagKey && !note.tags.some((t) => t.name.toLowerCase() === tagKey)) return false;
        if (opts.q && !likeMatch(note.body, `%${opts.q}%`)) return false;
        return true;
      });

      const { page, nextCursor } = paginate(filtered, limit, opts.cursor, (n) => n.createdAt);
      return { notes: page, nextCursor };
    });
  }

  async findTrash(
    sub: string,
    opts: { limit?: number; cursor?: string },
  ): Promise<NotePage> {
    const limit = opts.limit ?? 50;
    const cacheKey = `note:trash:${hashOptions({ limit: opts.limit, cursor: opts.cursor })}`;
    return this.cache.getThrough(sub, cacheKey, async () => {
      // Metadata-only SQL mirroring `findAll`: trashed rows only, in today's
      // `deletedAt DESC` / `id` DESC order, then keyset-paginated in memory so a
      // same-timestamp tie can never repeat or skip the boundary row.
      const rows = await this.notes
        .createQueryBuilder('note')
        .leftJoinAndSelect('note.tags', 'tag')
        .where('note.deletedAt IS NOT NULL')
        .andWhere('note.ownerSub = :sub', { sub })
        .orderBy('note.deletedAt', 'DESC')
        .addOrderBy('note.id', 'DESC')
        .getMany();

      const decoded = await this.decryptMany(rows, sub);
      const { page, nextCursor } = paginate(decoded, limit, opts.cursor, (n) => n.deletedAt!);
      return { notes: page, nextCursor };
    });
  }

  async findOne(sub: string, id: string): Promise<NoteDto> {
    return this.cache.getThrough(sub, `note:one:${id}`, async () => {
      const note = await this.notes.findOne({
        where: { id, ownerSub: sub, deletedAt: IsNull() },
        relations: { tags: true },
      });
      if (!note) throw new NotFoundException('Note not found');
      return this.decryptOne(note, sub);
    });
  }

  async update(
    sub: string,
    id: string,
    body?: string,
    tagNames?: string[],
    expectedVersion?: number,
  ): Promise<NoteDto> {
    const note = await this.notes.findOne({
      where: { id, ownerSub: sub, deletedAt: IsNull() },
      relations: { tags: true },
    });
    if (!note) throw new NotFoundException('Note not found');
    if (expectedVersion !== undefined && note.version !== expectedVersion) {
      throw new ConflictException('Note was modified');
    }
    // Write path: always envelopes. Re-encrypting with a fresh nonce is correct
    // even when the plaintext is unchanged.
    const dek = await this.requireKeys().getOrCreateDek(sub);
    if (body !== undefined) note.body = encryptField(dek, body, noteBodyAad(sub, note.id));
    if (tagNames !== undefined) {
      note.tags = await this.resolveTags(sub, normalizeTags(tagNames), dek);
    }
    note.version += 1;
    const saved = await this.notes.save(note);
    // Bump AFTER the mutation — see bumpGeneration(); a 409 above never bumps.
    await this.cache.bumpGeneration(sub);
    return this.toDto(saved, sub, dek);
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
      relations: { tags: true },
    });
    if (!note) throw new NotFoundException('Note not found');
    note.deletedAt = null;
    const saved = await this.notes.save(note);
    await this.cache.bumpGeneration(sub);
    return this.decryptOne(saved, sub);
  }

  async removePermanent(sub: string, id: string): Promise<void> {
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

  async listTags(sub: string): Promise<{ id: number; name: string }[]> {
    return this.cache.getThrough(sub, 'note:tags', async () => {
      const tags = await this.tags
        .createQueryBuilder('tag')
        .innerJoin('tag.notes', 'note')
        .where('note.deletedAt IS NULL')
        .andWhere('tag.ownerSub = :sub', { sub })
        .getMany();
      const dek = tags.some((t) => t.name.startsWith(ENC_PREFIX))
        ? await this.requireKeys().getDekForRead(sub)
        : null;
      const names = tags.map((t) => ({
        id: t.id,
        name: this.openField(t.name, dek, tagNameAad(sub), 'tag', String(t.id)),
      }));
      // The former SQL `ORDER BY tag.name` cannot order ciphertext; sort on the
      // decrypted names so the API order stays deterministic and name-ascending.
      names.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return names;
    });
  }
}
