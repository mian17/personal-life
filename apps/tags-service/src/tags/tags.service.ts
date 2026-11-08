import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { CryptoError, ENC_PREFIX, decryptField, encryptField } from '@life/crypto';
import { likeMatch } from '@life/shared';
import { KeysService, DEFAULT_PAGE_LIMIT, paginate, runAtomicBatch } from '@life/service-kit';
import { Tag } from './tag.entity';
import { TAGS_CACHE, TagsCache } from './tags-cache';
import type { CreateTagDto } from './dto/create-tag.dto';
import type { BatchUpdateTagItem } from './dto/batch-tags.dto';

/** A create-or-get that either wrote a row or reused one. */
interface CreatedOrReused {
  tag: TagDto;
  created: boolean;
}

/** The registry DTO (`SPEC-tags-service` API): the `version` is the OCC counter. */
export interface TagDto {
  id: number;
  name: string;
  version: number;
  createdAt: string;
}

/**
 * One page of the owner's vocabulary (`SPEC-pagination-seam` §4: plural key,
 * `Tag` → `tags`). The set is hand-curated and naturally small, so the envelope
 * is one uniform list contract, not a bounded scan.
 */
export interface TagPage {
  tags: TagDto[];
  nextCursor: string | null;
  /** How many tags the whole filtered set holds — never this page's length. */
  total: number;
}

/** The single cached shape: the owner's serialized **ciphertext** tag rows. */
interface CachedTagRow {
  id: number;
  name: string;
  version: number;
  createdAt: string;
}

/**
 * AAD for a tag name (`SPEC-tags-service` Encryption Rules). Byte-identical to
 * note-service's historical shape so `SPEC-tags-extraction` migrates rows
 * unchanged. Tag ids are DB-assigned post-insert, so they cannot bind here.
 */
function tagNameAad(ownerSub: string): string {
  return `life.v1|${ownerSub}|tag|name`;
}

/** Serialize a tag entity into its ciphertext-row form (dates → ISO). */
function toCachedRow(tag: Tag): CachedTagRow {
  return {
    id: tag.id,
    name: tag.name,
    version: tag.version,
    createdAt: tag.createdAt.toISOString(),
  };
}

/**
 * True when a decrypted tag name passes the list's `q` filter. Matching is the
 * shared `LIKE` parity comparator, so the service and the app agree character
 * for character; a blank `q` is "no filter", never "match nothing".
 */
function matchesQuery(name: string, q: string | undefined): boolean {
  const wanted = q?.trim();
  return !wanted || likeMatch(name, `%${wanted}%`);
}

/** True when the stored name is an `enc.v1.` envelope (M5: the store starts encrypted). */
function isCiphertextRow(row: CachedTagRow): boolean {
  return typeof row?.name === 'string' && row.name.startsWith(ENC_PREFIX);
}

function isCiphertextRowList(rows: CachedTagRow[]): boolean {
  return rows.every(isCiphertextRow);
}

/** Reject a hit whose serialized rows are not all `enc.v1.` ciphertext. */
function decodeCiphertextRowList(raw: unknown): CachedTagRow[] {
  if (!Array.isArray(raw) || !raw.every(isCiphertextRow)) {
    throw new Error('cache entry is not ciphertext');
  }
  return raw;
}

@Injectable()
export class TagsService {
  private readonly logger = new Logger(TagsService.name);

  /**
   * `openName` passed as a bound reference would only matter if it logged
   * through `this`; it does, so the binding is kept explicit.
   */
  private readonly openNameCb = this.openName.bind(this);

  constructor(
    @InjectRepository(Tag) private readonly tags: Repository<Tag>,
    @Inject(TAGS_CACHE) private readonly cache: TagsCache,
    private readonly keys: KeysService,
  ) {}

  /**
   * Decrypt-or-fail-closed for one stored name. There is **no dual-read** (M5):
   * a name without the `enc.v1.` prefix is corruption/tamper, so it throws the
   * typed `CryptoError` after one ids-only log line — never a plaintext
   * passthrough. Ids only: never content or key material.
   */
  private openName(stored: string, dek: Buffer, ownerSub: string, id: number): string {
    if (!stored.startsWith(ENC_PREFIX)) {
      this.logger.error(`decrypt failed for tag ${id}`);
      throw new CryptoError('stored tag name is not an enc.v1 envelope');
    }
    try {
      return decryptField(dek, stored, tagNameAad(ownerSub));
    } catch (err) {
      this.logger.error(`decrypt failed for tag ${id}`);
      throw err;
    }
  }

  /**
   * The owner's whole ciphertext row-set — the one cached entry
   * (`tags:<sub>:v<gen>:all`) serving both list and resolve. The loader is the
   * only DB access; decrypt/sort/filter all happen after every hit.
   */
  private rawRows(sub: string): Promise<CachedTagRow[]> {
    return this.cache.getAllThrough(
      sub,
      async () => {
        const found = await this.tags.find({ where: { ownerSub: sub }, order: { id: 'ASC' } });
        return found.map(toCachedRow);
      },
      { decode: decodeCiphertextRowList, cacheable: isCiphertextRowList },
    );
  }

  /**
   * Write paths read the **source of truth** directly (never the cache): a
   * create/rename collision check must not be decided by a possibly-stale
   * read-through entry, and a write must not populate a generation it is about
   * to invalidate. The cache is read-only plumbing for `list`/`resolve` — the
   * same split as note-service's `resolveTags` vs `listTags`.
   */
  private ownerRows(manager: EntityManager | undefined, sub: string): Promise<Tag[]> {
    return this.tagsRepository(manager).find({
      where: { ownerSub: sub },
      order: { id: 'ASC' },
    });
  }

  /**
   * The repository one write runs against. A manager means "inside this
   * transaction", and every write a batch performs must go through it — an item
   * of a batch has to see the items submitted before it. No manager means the
   * service's own repository: the singular path.
   */
  private tagsRepository(manager: EntityManager | undefined): Repository<Tag> {
    if (!manager) return this.tags;
    return manager.getRepository(Tag);
  }

  /**
   * The datasource a batch opens its one transaction on — the same DB the writes
   * use.
   *
   * ponytail: taken from the injected repository rather than a fourth
   * constructor argument, so the cache suite that builds this service
   * positionally keeps compiling. Upgrade path: `@InjectDataSource()` once that
   * suite is converted to a Nest testing module.
   */
  private get writeDataSource() {
    return this.tags.manager.connection;
  }

  /**
   * Decrypt the owner's rows (at most one DEK unwrap per read). An empty set
   * needs no key; a non-empty set is all-ciphertext by the loader contract, so a
   * missing `user_keys` row fails closed with `CryptoError`.
   */
  private async decodeRows(sub: string, rows: CachedTagRow[]): Promise<TagDto[]> {
    if (rows.length === 0) return [];
    const dek = await this.keys.getDekForRead(sub);
    return rows.map((row) => ({
      id: row.id,
      name: this.openNameCb(row.name, dek, sub, row.id),
      version: row.version,
      createdAt: row.createdAt,
    }));
  }

  /** Name-ascending, case-insensitive, `id` as the deterministic tie-break. */
  private static byName(a: TagDto, b: TagDto): number {
    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    if (an !== bn) return an < bn ? -1 : 1;
    return a.id - b.id;
  }

  /**
   * `byName`'s strictly-after test, in that same order: a row comes after the
   * cursor when its **lower-cased** name sorts later, or when the names tie and
   * its numeric `id` is larger. Folding case exactly as the sort does is what
   * keeps the boundary honest — comparing raw names here would let `Zebra` sort
   * before `apple` and repeat or skip a row at a page edge.
   */
  private static afterName(row: TagDto, at: string[]): boolean {
    const [name, id] = at;
    const lowered = row.name.toLowerCase();
    if (lowered !== name) return lowered > name;
    return row.id > Number(id);
  }

  /** `GET /api/tags` — decrypted, name-sorted (case-insensitive): the whole set. */
  async list(sub: string): Promise<TagDto[]> {
    const rows = await this.rawRows(sub);
    const decoded = await this.decodeRows(sub, rows);
    return decoded.sort(TagsService.byName);
  }

  /**
   * `GET /api/tags?q=&limit=&cursor=` — one page of that same order on the shared
   * cursor seam. Pagination is a post-hit projection: `limit`/`cursor`/`q` never
   * enter the `tags:<sub>:v<gen>:all` key, so one entry serves every page and
   * every search variant.
   *
   * The vocabulary is hand-curated and small, so the window is the shared list
   * contract, not a bounded scan; the app still needs every tag (the picker offers
   * all of them), so it walks this envelope to exhaustion.
   */
  async page(
    sub: string,
    opts: { q?: string; limit?: number; cursor?: string } = {},
  ): Promise<TagPage> {
    const ordered = (await this.list(sub)).filter((tag) => matchesQuery(tag.name, opts.q));
    const page = paginate(ordered, {
      limit: opts.limit ?? DEFAULT_PAGE_LIMIT,
      cursor: opts.cursor,
      // The cursor carries the *lower-cased* name, matching the sort key and
      // `afterName`; `id` last keeps it unique per row.
      keyOf: (tag) => [tag.name.toLowerCase(), String(tag.id)],
      after: TagsService.afterName,
    });
    return { tags: page.rows, nextCursor: page.nextCursor, total: page.total };
  }

  /**
   * `POST /api/tags {name}` — create-or-get, case-insensitive per owner. Only a
   * brand-new name writes, so only a brand-new name bumps the generation.
   */
  async create(sub: string, name: string): Promise<CreatedOrReused> {
    const result = await this.createOrGetOne(this.tags.manager, sub, name);
    if (result.created) {
      await this.cache.bumpGeneration(sub);
    }
    return result;
  }

  /**
   * The `tags` batch create: one transaction, submission order, and one bump —
   * only if some item actually wrote (`SPEC-tags-service.md` §6). A batch of
   * already-existing names is all create-or-get hits, so it commits no write and
   * leaves the owner's counter alone.
   */
  async createMany(sub: string, items: CreateTagDto[]): Promise<TagDto[]> {
    const results = await runAtomicBatch({
      items,
      sub,
      dataSource: this.writeDataSource,
      cache: this.cache,
      runItem: (item, manager) => this.createOrGetOne(manager, sub, item.name),
      invalidate: (rows) => rows.some((row) => row.created),
    });
    return results.map((result) => result.tag);
  }

  /**
   * One name's create-or-get, through the caller's manager, and with no bump.
   * Any matching row of the caller is reused with its original spelling; only a
   * brand-new name writes.
   */
  private async createOrGetOne(
    manager: EntityManager | undefined,
    sub: string,
    name: string,
  ): Promise<CreatedOrReused> {
    const dek = await this.keys.getOrCreateDek(sub);
    const existing = await this.findByName(manager, sub, dek, name);
    if (existing) {
      return {
        tag: {
          id: existing.id,
          name: this.openName(existing.name, dek, sub, existing.id),
          version: existing.version,
          createdAt: existing.createdAt.toISOString(),
        },
        created: false,
      };
    }

    const tags = this.tagsRepository(manager);
    const saved = await tags.save(
      tags.create({
        name: encryptField(dek, name, tagNameAad(sub)),
        ownerSub: sub,
        version: 0,
        createdAt: new Date(),
      }),
    );
    return { tag: { ...toCachedRow(saved), name }, created: true };
  }

  /** The caller's row whose decrypted name matches `name`, case-insensitively. */
  private async findByName(
    manager: EntityManager | undefined,
    sub: string,
    dek: Buffer,
    name: string,
  ): Promise<Tag | undefined> {
    const wanted = name.toLowerCase();
    const rows = await this.ownerRows(manager, sub);
    return rows.find(
      (row) => this.openName(row.name, dek, sub, row.id).toLowerCase() === wanted,
    );
  }

  /**
   * `PATCH /api/tags/:id {name, expectedVersion?}` — rename. Every path here
   * mutates, so the singular route bumps unconditionally after it returns.
   */
  async rename(
    sub: string,
    id: number,
    name: string,
    expectedVersion?: number,
  ): Promise<TagDto> {
    const tag = await this.renameOne(this.tags.manager, sub, id, name, expectedVersion);
    // Bump AFTER the mutation — see bumpGeneration(); a thrown rename never bumps.
    await this.cache.bumpGeneration(sub);
    return tag;
  }

  /** The `tags` batch rename: one transaction, submission order, one bump. */
  async renameMany(sub: string, items: BatchUpdateTagItem[]): Promise<TagDto[]> {
    return runAtomicBatch({
      items,
      sub,
      dataSource: this.writeDataSource,
      cache: this.cache,
      runItem: (item, manager) =>
        this.renameOne(manager, sub, item.id, item.name, item.expectedVersion),
    });
  }

  /**
   * One tag's rename, through the caller's manager, and with no bump. A foreign
   * or missing id is a byte-identical 404 (never 403). A case-insensitive
   * collision with a *different* tag of the same owner is 409; a stale
   * `expectedVersion` is 409. Any of those throws, which for a batch rolls the
   * whole request back.
   */
  private async renameOne(
    manager: EntityManager | undefined,
    sub: string,
    id: number,
    name: string,
    expectedVersion?: number,
  ): Promise<TagDto> {
    const tags = this.tagsRepository(manager);
    const tag = await tags.findOne({ where: { id, ownerSub: sub } });
    if (!tag) throw new NotFoundException('Tag not found');
    if (expectedVersion !== undefined && tag.version !== expectedVersion) {
      throw new ConflictException('Tag was modified');
    }

    const dek = await this.keys.getOrCreateDek(sub);
    const wanted = name.toLowerCase();
    const siblings = await this.ownerRows(manager, sub);
    const collision = siblings.some(
      (row) =>
        row.id !== id && this.openName(row.name, dek, sub, row.id).toLowerCase() === wanted,
    );
    if (collision) throw new ConflictException('Tag name already exists');

    tag.name = encryptField(dek, name, tagNameAad(sub));
    tag.version += 1;
    const saved = await tags.save(tag);
    return { ...toCachedRow(saved), name };
  }

  /**
   * `DELETE /api/tags/:id` — delete the vocabulary row. Consumers detach; this
   * service never touches domain content. Foreign/missing → byte-identical 404.
   */
  async remove(sub: string, id: number): Promise<void> {
    const result = await this.tags.delete({ id, ownerSub: sub });
    if (!result.affected) throw new NotFoundException('Tag not found');
    await this.cache.bumpGeneration(sub);
  }

  /**
   * `POST /api/tags/resolve {ids}` — `[{id, name}]` for the caller's own tags, in
   * the requested order; unknown/foreign ids are omitted (consumers treat an
   * omitted id as detached). Served from the same cached row-set as `list`.
   */
  async resolve(sub: string, ids: number[]): Promise<Array<{ id: number; name: string }>> {
    const rows = await this.rawRows(sub);
    const decoded = await this.decodeRows(sub, rows);
    const byId = new Map(decoded.map((t) => [t.id, t.name]));
    const out: Array<{ id: number; name: string }> = [];
    for (const id of ids) {
      const name = byId.get(id);
      if (name !== undefined) out.push({ id, name });
    }
    return out;
  }
}
