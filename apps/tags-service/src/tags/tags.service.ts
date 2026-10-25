import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CryptoError, ENC_PREFIX, decryptField, encryptField } from '@life/crypto';
import { Tag } from './tag.entity';
import { KeysService } from '../keys/keys.service';
import { TAGS_CACHE, TagsCache } from './tags-cache';

/** The registry DTO (`SPEC-tags-service` API): the `version` is the OCC counter. */
export interface TagDto {
  id: number;
  name: string;
  version: number;
  createdAt: string;
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
    return this.cache.getThrough(
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
  private ownerRows(sub: string): Promise<Tag[]> {
    return this.tags.find({ where: { ownerSub: sub }, order: { id: 'ASC' } });
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

  /** `GET /api/tags` — decrypted, name-sorted (case-insensitive). */
  async list(sub: string): Promise<TagDto[]> {
    const rows = await this.rawRows(sub);
    const decoded = await this.decodeRows(sub, rows);
    return decoded.sort(TagsService.byName);
  }

  /**
   * `POST /api/tags {name}` — create-or-get, case-insensitive per owner. Any
   * matching row (of the caller) is reused with its original spelling; only a
   * brand-new name writes and bumps the generation.
   */
  async create(sub: string, name: string): Promise<{ tag: TagDto; created: boolean }> {
    const dek = await this.keys.getOrCreateDek(sub);
    const rows = await this.ownerRows(sub);
    const wanted = name.toLowerCase();
    const existing = rows.find(
      (row) => this.openName(row.name, dek, sub, row.id).toLowerCase() === wanted,
    );
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

    const saved = await this.tags.save(
      this.tags.create({
        name: encryptField(dek, name, tagNameAad(sub)),
        ownerSub: sub,
        version: 0,
        createdAt: new Date(),
      }),
    );
    // Bump AFTER the mutation: pre-write entries die here, a thrown save never bumps.
    await this.cache.bumpGeneration(sub);
    return { tag: { ...toCachedRow(saved), name }, created: true };
  }

  /**
   * `PATCH /api/tags/:id {name, expectedVersion?}` — rename. A foreign or missing
   * id is a byte-identical 404 (never 403). A case-insensitive collision with a
   * *different* tag of the same owner is 409; a stale `expectedVersion` is 409.
   */
  async rename(
    sub: string,
    id: number,
    name: string,
    expectedVersion?: number,
  ): Promise<TagDto> {
    const tag = await this.tags.findOne({ where: { id, ownerSub: sub } });
    if (!tag) throw new NotFoundException('Tag not found');
    if (expectedVersion !== undefined && tag.version !== expectedVersion) {
      throw new ConflictException('Tag was modified');
    }

    const dek = await this.keys.getOrCreateDek(sub);
    const wanted = name.toLowerCase();
    const siblings = await this.ownerRows(sub);
    const collision = siblings.some(
      (row) =>
        row.id !== id && this.openName(row.name, dek, sub, row.id).toLowerCase() === wanted,
    );
    if (collision) throw new ConflictException('Tag name already exists');

    tag.name = encryptField(dek, name, tagNameAad(sub));
    tag.version += 1;
    const saved = await this.tags.save(tag);
    await this.cache.bumpGeneration(sub);
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
