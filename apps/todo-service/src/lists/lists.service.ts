import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { CryptoError, ENC_PREFIX, decryptField, encryptField } from '@life/crypto';
import { List } from './list.entity';
import { KeysService } from '@life/service-kit';
import { TODO_CACHE, TODO_LISTS, TodosCache } from '../cache/todo-cache';

/** The list DTO (`SPEC-todo-service` API): `version` is the OCC counter. */
export interface ListDto {
  id: string;
  name: string;
  importantDefault: boolean | null;
  version: number;
  createdAt: string;
}

/** The cached shape: one serialized **ciphertext** list row. */
interface CachedListRow {
  id: string;
  name: string;
  importantDefault: boolean | null;
  version: number;
  createdAt: string;
}

/**
 * AAD for a list name (`SPEC-todo-service` Data model). Byte-exact: the same
 * string must be reconstructed at encrypt and decrypt, so the service-generated
 * UUID is set before the ciphertext exists.
 */
function listNameAad(ownerSub: string, id: string): string {
  return `life.v1|${ownerSub}|list|name|${id}`;
}

/** Serialize a list entity into its ciphertext-row form (dates → ISO). */
function toCachedListRow(list: List): CachedListRow {
  return {
    id: list.id,
    name: list.name,
    // Plaintext, non-content (`SPEC-todo-importance`): the cache stores rows as
    // persisted, so the default rides the cached list row exactly like `done`.
    importantDefault: list.importantDefault,
    version: list.version,
    createdAt: list.createdAt.toISOString(),
  };
}

/** True when the stored name is an `enc.v1.` envelope (M5 — starts encrypted). */
function isCiphertextListRow(row: CachedListRow): boolean {
  return typeof row?.name === 'string' && row.name.startsWith(ENC_PREFIX);
}

function isCiphertextListRowList(rows: CachedListRow[]): boolean {
  return rows.every(isCiphertextListRow);
}

/** Reject a hit whose serialized rows are not all `enc.v1.` ciphertext. */
function decodeCiphertextListRowList(raw: unknown): CachedListRow[] {
  if (!Array.isArray(raw) || !raw.every(isCiphertextListRow)) {
    throw new Error('cache entry is not ciphertext');
  }
  return raw;
}

@Injectable()
export class ListsService {
  private readonly logger = new Logger(ListsService.name);

  /**
   * `openName` passed as a bound reference must stay `this`-bound: its catch
   * path logs through `this.logger`, and an unbound reference would mask the
   * real `CryptoError` on tampered rows.
   */
  private readonly openNameCb = this.openName.bind(this);

  constructor(
    @InjectRepository(List) private readonly lists: Repository<List>,
    @Inject(TODO_CACHE) private readonly cache: TodosCache,
    private readonly keys: KeysService,
  ) {}

  /**
   * Decrypt-or-fail-closed for one stored name. There is **no dual-read** (M5):
   * a name without the `enc.v1.` prefix is corruption/tamper, so it throws the
   * typed `CryptoError` after one ids-only log line — never a plaintext
   * passthrough. Ids only: never content or key material.
   */
  private openName(stored: string, dek: Buffer, ownerSub: string, id: string): string {
    if (!stored.startsWith(ENC_PREFIX)) {
      this.logger.error(`decrypt failed for list ${id}`);
      throw new CryptoError('stored list name is not an enc.v1 envelope');
    }
    try {
      return decryptField(dek, stored, listNameAad(ownerSub, id));
    } catch (err) {
      this.logger.error(`decrypt failed for list ${id}`);
      throw err;
    }
  }

  /**
   * The owner's whole ciphertext list row-set — the one cached `todo:lists`
   * entry. Public because `TodosService` joins it (in memory, post-hit) to
   * compute `effectiveImportant` from the same cached source, never a second
   * loader (Contract 2 no-fork).
   */
  rawRows(sub: string): Promise<CachedListRow[]> {
    return this.cache.getThrough(
      sub,
      TODO_LISTS,
      async () => {
        const found = await this.lists.find({
          where: { ownerSub: sub },
          order: { createdAt: 'ASC' },
        });
        return found.map(toCachedListRow);
      },
      { decode: decodeCiphertextListRowList, cacheable: isCiphertextListRowList },
    );
  }

  /**
   * Write paths read the **source of truth** directly (never the cache): a
   * collision check must not be decided by a possibly-stale entry, and a write
   * must not populate a generation it is about to invalidate.
   */
  private ownerRows(sub: string): Promise<List[]> {
    return this.lists.find({ where: { ownerSub: sub }, order: { createdAt: 'ASC' } });
  }

  /** Decrypt the owner's rows (at most one DEK unwrap per read). */
  private async decodeRows(sub: string, rows: CachedListRow[]): Promise<ListDto[]> {
    if (rows.length === 0) return [];
    const dek = await this.keys.getDekForRead(sub);
    return rows.map((row) => ({
      id: row.id,
      name: this.openNameCb(row.name, dek, sub, row.id),
      importantDefault: row.importantDefault,
      version: row.version,
      createdAt: row.createdAt,
    }));
  }

  /** Name-ascending, case-insensitive, `id` as the deterministic tie-break. */
  private static byName(a: ListDto, b: ListDto): number {
    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    if (an !== bn) return an < bn ? -1 : 1;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  }

  /** `GET /api/lists` — decrypted, name-sorted (case-insensitive). */
  async list(sub: string): Promise<ListDto[]> {
    const rows = await this.rawRows(sub);
    const decoded = await this.decodeRows(sub, rows);
    return decoded.sort(ListsService.byName);
  }

  /**
   * `POST /api/lists {name, importantDefault?}` — create. A case-insensitive
   * collision with an existing list of the same owner is 409.
   */
  async create(
    sub: string,
    name: string,
    importantDefault: boolean | null = null,
  ): Promise<ListDto> {
    const dek = await this.keys.getOrCreateDek(sub);
    const rows = await this.ownerRows(sub);
    const wanted = name.toLowerCase();
    const collision = rows.some(
      (row) => this.openName(row.name, dek, sub, row.id).toLowerCase() === wanted,
    );
    if (collision) throw new ConflictException('List name already exists');

    // The AAD binds the generated id, so it must exist before the ciphertext.
    const id = randomUUID();
    const saved = await this.lists.save(
      this.lists.create({
        id,
        name: encryptField(dek, name, listNameAad(sub, id)),
        importantDefault,
        ownerSub: sub,
        version: 0,
        createdAt: new Date(),
      }),
    );
    // Bump AFTER the mutation: pre-write entries die here.
    await this.cache.bumpGeneration(sub);
    return { ...toCachedListRow(saved), name };
  }

  /**
   * `PATCH /api/lists/:id {name, importantDefault?, expectedVersion?}` — rename
   * and/or set the default importance. A foreign or missing id is a
   * byte-identical 404 (never 403). A case-insensitive collision with a
   * *different* list of the same owner is 409; a stale `expectedVersion` is 409.
   * `importantDefault` omitted = unchanged; `null` = clear to false.
   */
  async update(
    sub: string,
    id: string,
    name: string,
    importantDefault?: boolean | null,
    expectedVersion?: number,
  ): Promise<ListDto> {
    const list = await this.lists.findOne({ where: { id, ownerSub: sub } });
    if (!list) throw new NotFoundException('List not found');
    if (expectedVersion !== undefined && list.version !== expectedVersion) {
      throw new ConflictException('List was modified');
    }

    const dek = await this.keys.getOrCreateDek(sub);
    const wanted = name.toLowerCase();
    const siblings = await this.ownerRows(sub);
    const collision = siblings.some(
      (row) => row.id !== id && this.openName(row.name, dek, sub, row.id).toLowerCase() === wanted,
    );
    if (collision) throw new ConflictException('List name already exists');

    list.name = encryptField(dek, name, listNameAad(sub, id));
    if (importantDefault !== undefined) list.importantDefault = importantDefault;
    list.version += 1;
    const saved = await this.lists.save(list);
    await this.cache.bumpGeneration(sub);
    return { ...toCachedListRow(saved), name };
  }

  /**
   * `DELETE /api/lists/:id` — remove the list. Its todos survive: the
   * `todo.listId` FK is `ON DELETE SET NULL`, so SQLite detaches them. Foreign or
   * missing id → byte-identical 404.
   */
  async remove(sub: string, id: string): Promise<void> {
    const result = await this.lists.delete({ id, ownerSub: sub });
    if (!result.affected) throw new NotFoundException('List not found');
    await this.cache.bumpGeneration(sub);
  }

  /**
   * Assert that `listId` names one of the caller's own lists, else 404. Used by
   * the todo write paths: the `todo.listId` FK would otherwise surface a
   * raw constraint failure, and a foreign id must stay indistinguishable from a
   * missing one.
   */
  async assertOwnedList(sub: string, id: string): Promise<void> {
    const found = await this.lists.findOne({ where: { id, ownerSub: sub } });
    if (!found) throw new NotFoundException('List not found');
  }
}
