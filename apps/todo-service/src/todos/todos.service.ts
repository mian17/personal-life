import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { CryptoError, ENC_PREFIX, decryptField, encryptField } from '@life/crypto';
import { likeMatch } from '@life/shared';
import type { TagUsage, Todo as TodoDto, TodoPage } from '@life/shared';
import { Todo } from './todo.entity';
import { TodoTag } from './todo-tag.entity';
import { KeysService } from '../keys/keys.service';
import { ListsService } from '../lists/lists.service';
import { TODO_ALL, TODO_CACHE, TODO_TAGS, TodosCache } from '../cache/todo-cache';
import { DATE_ONLY } from './dto/create-todo.dto';

/**
 * Deduplicate the `tagIds` a write carries, preserving first-seen order then
 * sorting. The result is the association set stored for the todo (TagRef
 * semantics, `SPEC-service-kernel`): todo-service stores exactly the ids it is
 * given — no registry validation, no name resolution (names live in
 * `tags-service`).
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
 * AAD for a todo field (`SPEC-todo-service` Data model), byte-exact and uniform:
 * the identical string must be reconstructed at encrypt and decrypt, so the
 * service-generated `id` exists before the ciphertext.
 */
function todoTitleAad(ownerSub: string, id: string): string {
  return `life.v1|${ownerSub}|todo|title|${id}`;
}

function todoNoteAad(ownerSub: string, id: string): string {
  return `life.v1|${ownerSub}|todo|note|${id}`;
}

/**
 * Ciphertext-row shape stored in Redis (`SPEC-todo-service` Cache Rules). The
 * cache holds **rows as stored** — `title`/`note` are `enc.v1.` envelopes —
 * never a decrypted DTO. `tagIds` are association ids (metadata) copied verbatim
 * so the tag filter and the DTO can run after a hit; `dueDate`/`done`/`listId`
 * are plaintext metadata. `origin` is the reserved seam (unused).
 */
interface CachedTodoRow {
  id: string;
  title: string;
  note: string | null;
  done: boolean;
  dueDate: string | null;
  listId: string | null;
  origin: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  tagIds: number[];
}

/** Serialize a todo entity into its ciphertext-row form (dates → ISO). */
function toCachedTodoRow(todo: Todo): CachedTodoRow {
  return {
    id: todo.id,
    title: todo.title,
    note: todo.note,
    done: todo.done,
    dueDate: todo.dueDate,
    listId: todo.listId,
    origin: todo.origin,
    version: todo.version,
    createdAt: todo.createdAt.toISOString(),
    updatedAt: todo.updatedAt.toISOString(),
    tagIds: (todo.todoTags ?? []).map((tt) => tt.tagId).sort((a, b) => a - b),
  };
}

/**
 * True when the serialized row's content fields are `enc.v1.` envelopes, so the
 * populate may touch Redis. There is **no dual-read** in this service (M5): a
 * row without the envelope is corruption/tamper and is rejected by `decode`
 * rather than cached.
 */
function isCiphertextTodoRow(row: CachedTodoRow): boolean {
  const titleOk = typeof row?.title === 'string' && row.title.startsWith(ENC_PREFIX);
  const noteOk = row?.note === null || (typeof row?.note === 'string' && row.note.startsWith(ENC_PREFIX));
  return titleOk && noteOk;
}

function isCiphertextTodoRowList(rows: CachedTodoRow[]): boolean {
  return rows.every(isCiphertextTodoRow);
}

function decodeCiphertextTodoRowList(raw: unknown): CachedTodoRow[] {
  if (!Array.isArray(raw) || !raw.every(isCiphertextTodoRow)) {
    throw new Error('cache entry is not ciphertext');
  }
  return raw;
}

/**
 * The `todo:tags` cache holds **metadata only** (ids + counts, no names). A hit
 * is valid when every row has numeric `tagId`/`count` fields.
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

/** A hydrated, decrypted todo plus its stable ordering key. */
interface OrderedTodo {
  dto: TodoDto;
  /** `dueDate` or `~` for undated — the first cursor component. */
  due: string;
}

/**
 * The domain order (`SPEC-todo-service` Behaviour): due-dated ascending (overdue
 * first), undated last, `createdAt DESC` tie-break, `id DESC` as the final
 * deterministic tie-break. `dueDate` is `YYYY-MM-DD` and `createdAt` is ISO, so
 * both compare correctly as strings.
 */
function compareTodos(a: OrderedTodo, b: OrderedTodo): number {
  const aDated = a.dto.dueDate !== null;
  const bDated = b.dto.dueDate !== null;
  if (aDated && bDated && a.dto.dueDate !== b.dto.dueDate) {
    return a.dto.dueDate! < b.dto.dueDate! ? -1 : 1;
  }
  if (aDated !== bDated) return aDated ? -1 : 1;
  if (a.dto.createdAt !== b.dto.createdAt) {
    return a.dto.createdAt > b.dto.createdAt ? -1 : 1;
  }
  if (a.dto.id === b.dto.id) return 0;
  return a.dto.id > b.dto.id ? -1 : 1;
}

/** Decode the `base64(<dueDate-or-~>|<createdAt>|<id>)` cursor (kernel clause). */
function decodeCursor(cursor: string): { due: string; createdAt: string; id: string } {
  const [due, createdAt, id] = Buffer.from(cursor, 'base64').toString().split('|');
  return { due, createdAt, id };
}

function encodeCursor(item: OrderedTodo): string {
  return Buffer.from(`${item.due}|${item.dto.createdAt}|${item.dto.id}`).toString('base64');
}

/** True when `item` falls strictly after the cursor in the domain order. */
function afterCursor(item: OrderedTodo, cursor: { due: string; createdAt: string; id: string }): boolean {
  const { dto } = item;
  if (cursor.due === '~') {
    // Cursor is in the undated group: only undated rows can follow.
    if (dto.dueDate !== null) return false;
    return (
      dto.createdAt < cursor.createdAt ||
      (dto.createdAt === cursor.createdAt && dto.id < cursor.id)
    );
  }
  // Cursor is dated: undated rows always follow.
  if (dto.dueDate === null) return true;
  if (dto.dueDate > cursor.due) return true;
  if (dto.dueDate < cursor.due) return false;
  return (
    dto.createdAt < cursor.createdAt ||
    (dto.createdAt === cursor.createdAt && dto.id < cursor.id)
  );
}

@Injectable()
export class TodosService {
  private readonly logger = new Logger(TodosService.name);

  constructor(
    @InjectRepository(Todo) private readonly todos: Repository<Todo>,
    @InjectRepository(TodoTag) private readonly todoTags: Repository<TodoTag>,
    @Inject(TODO_CACHE) private readonly cache: TodosCache,
    private readonly keys: KeysService,
    private readonly lists: ListsService,
  ) {}

  /**
   * Decrypt-or-fail-closed for one stored content field. There is no dual-read
   * (M5): a missing `enc.v1.` prefix is corruption/tamper, so it throws the
   * typed `CryptoError` after one **ids-only** log line — never a plaintext
   * passthrough, never content or key material in the log.
   */
  private openField(stored: string, dek: Buffer, aad: string, id: string): string {
    if (!stored.startsWith(ENC_PREFIX)) {
      this.logger.error(`decrypt failed for todo ${id}`);
      throw new CryptoError('stored todo field is not an enc.v1 envelope');
    }
    try {
      return decryptField(dek, stored, aad);
    } catch (err) {
      this.logger.error(`decrypt failed for todo ${id}`);
      throw err;
    }
  }

  /** Assemble the wire DTO from a validated ciphertext row. */
  private decodeCachedTodoRow(row: CachedTodoRow, sub: string, dek: Buffer | null): TodoDto {
    if (!dek) {
      // Non-empty rows always carry a title envelope; a missing key cannot occur
      // on a well-formed read, and returning ciphertext would be worse.
      throw new CryptoError('missing data key for an encrypted field');
    }
    return {
      id: row.id,
      title: this.openField(row.title, dek, todoTitleAad(sub, row.id), row.id),
      note:
        row.note === null
          ? null
          : this.openField(row.note, dek, todoNoteAad(sub, row.id), row.id),
      done: row.done,
      dueDate: row.dueDate,
      listId: row.listId,
      tagIds: [...row.tagIds],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      version: row.version,
    };
  }

  /** Resolve the owner DEK for a set of ciphertext rows (at most once per read). */
  private async readDek(sub: string, rows: CachedTodoRow[]): Promise<Buffer | null> {
    if (rows.length === 0) return null;
    return this.keys.getDekForRead(sub);
  }

  /** `['YYYY-MM-DD']` guard for the DTO's length-only check. */
  private assertDate(value: string): void {
    if (!DATE_ONLY.test(value)) throw new BadRequestException('dueDate must be YYYY-MM-DD');
  }

  /** The owner's full ciphertext row-set — the one cached `todo:all` entry. */
  private async rawRows(sub: string): Promise<CachedTodoRow[]> {
    return this.cache.getThrough(
      sub,
      TODO_ALL,
      async () => {
        // Metadata-only SQL: content is encrypted, so every filter/page runs in
        // memory after decryption; one cached row-set serves every variant.
        const found = await this.todos
          .createQueryBuilder('todo')
          .leftJoinAndSelect('todo.todoTags', 'todoTag')
          .where('todo.ownerSub = :sub', { sub })
          .getMany();
        return found.map(toCachedTodoRow);
      },
      { decode: decodeCiphertextTodoRowList, cacheable: isCiphertextTodoRowList },
    );
  }

  /** `POST /api/todos` — 201 with `version: 0`. */
  async create(
    sub: string,
    input: {
      title: string;
      note?: string;
      dueDate?: string;
      listId?: string;
      tagIds?: number[];
    },
  ): Promise<TodoDto> {
    if (input.dueDate !== undefined) this.assertDate(input.dueDate);
    if (input.listId !== undefined) await this.lists.assertOwnedList(sub, input.listId);

    const id = randomUUID();
    const ids = normalizeTagIds(input.tagIds);
    const dek = await this.keys.getOrCreateDek(sub);
    const now = new Date();
    const todo = this.todos.create({
      id,
      title: encryptField(dek, input.title, todoTitleAad(sub, id)),
      note:
        input.note === undefined ? null : encryptField(dek, input.note, todoNoteAad(sub, id)),
      done: false,
      dueDate: input.dueDate ?? null,
      listId: input.listId ?? null,
      origin: null,
      ownerSub: sub,
      version: 0,
      createdAt: now,
      updatedAt: now,
    });
    const saved = await this.todos.save(todo);
    // Association rows are managed explicitly (TagRef joins, not a cascade
    // relation) so a write stores exactly the ids it carries.
    if (ids.length > 0) {
      await this.todoTags.insert(ids.map((tagId) => ({ todoId: id, tagId })));
    }
    // Bump AFTER the insert: pre-mutation reads die here; a thrown save never bumps.
    await this.cache.bumpGeneration(sub);
    return this.decodeCachedTodoRow({ ...toCachedTodoRow(saved), tagIds: ids }, sub, dek);
  }

  /**
   * `GET /api/todos` — cursor page over the domain order with every filter
   * applied in memory after the cache hit. One `todo:all` entry serves every
   * `q`/`tagId`/`listId`/`done`/`due*`/cursor/limit variant.
   */
  async findAll(
    sub: string,
    opts: {
      q?: string;
      listId?: string;
      tagId?: number;
      done?: boolean;
      dueBefore?: string;
      dueAfter?: string;
      limit?: number;
      cursor?: string;
    },
  ): Promise<TodoPage> {
    const limit = opts.limit ?? 50;
    const rows = await this.rawRows(sub);
    const dek = await this.readDek(sub, rows);
    const decoded = rows.map((row) => this.decodeCachedTodoRow(row, sub, dek));

    const filtered = decoded.filter((todo) => {
      if (opts.listId !== undefined && todo.listId !== opts.listId) return false;
      if (opts.tagId !== undefined && !todo.tagIds.includes(opts.tagId)) return false;
      if (opts.done !== undefined && todo.done !== opts.done) return false;
      if (opts.dueBefore !== undefined && !(todo.dueDate !== null && todo.dueDate < opts.dueBefore)) {
        return false;
      }
      if (opts.dueAfter !== undefined && !(todo.dueDate !== null && todo.dueDate > opts.dueAfter)) {
        return false;
      }
      if (
        opts.q &&
        !likeMatch(todo.title, `%${opts.q}%`) &&
        !likeMatch(todo.note ?? '', `%${opts.q}%`)
      ) {
        return false;
      }
      return true;
    });

    const ordered: OrderedTodo[] = filtered.map((dto) => ({
      dto,
      due: dto.dueDate ?? '~',
    }));
    ordered.sort(compareTodos);

    const after = opts.cursor
      ? ordered.filter((item) => afterCursor(item, decodeCursor(opts.cursor!)))
      : ordered;

    const hasMore = after.length > limit;
    const page = hasMore ? after.slice(0, limit) : after;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last) : null;
    return { todos: page.map((item) => item.dto), nextCursor };
  }

  /**
   * `GET /api/todos/:id` — served from the one cached `todo:all` row-set (the
   * spec enumerates exactly three todo cache shapes; the id is a filter, so no
   * id ever enters the key space). Decrypt, then slice by id in memory after the
   * hit. A foreign or missing id is a byte-identical 404.
   */
  async findOne(sub: string, id: string): Promise<TodoDto> {
    const rows = await this.rawRows(sub);
    const dek = await this.readDek(sub, rows);
    const found = rows.find((row) => row.id === id);
    if (!found) throw new NotFoundException('Todo not found');
    return this.decodeCachedTodoRow(found, sub, dek);
  }

  /**
   * `PATCH /api/todos/:id` — partial update. An omitted field is unchanged
   * (last-write-wins); explicit `null` clears `note`/`dueDate`/`listId`; a
   * `tagIds` write REPLACES the association set; a stale `expectedVersion` is
   * 409. Foreign/missing ids are a byte-identical 404.
   */
  async update(
    sub: string,
    id: string,
    patch: {
      title?: string;
      note?: string | null;
      done?: boolean;
      dueDate?: string | null;
      listId?: string | null;
      tagIds?: number[];
      expectedVersion?: number;
    },
  ): Promise<TodoDto> {
    if (patch.dueDate !== undefined && patch.dueDate !== null) this.assertDate(patch.dueDate);
    if (patch.listId !== undefined && patch.listId !== null) {
      await this.lists.assertOwnedList(sub, patch.listId);
    }

    // Load WITHOUT the relation: associations are managed explicitly below.
    const todo = await this.todos.findOne({ where: { id, ownerSub: sub } });
    if (!todo) throw new NotFoundException('Todo not found');
    if (patch.expectedVersion !== undefined && todo.version !== patch.expectedVersion) {
      throw new ConflictException('Todo was modified');
    }

    // Write path: always envelopes. Re-encrypting with a fresh nonce is correct
    // even when the plaintext is unchanged.
    const dek = await this.keys.getOrCreateDek(sub);
    if (patch.title !== undefined) {
      todo.title = encryptField(dek, patch.title, todoTitleAad(sub, id));
    }
    if (patch.note !== undefined) {
      todo.note = patch.note === null ? null : encryptField(dek, patch.note, todoNoteAad(sub, id));
    }
    if (patch.done !== undefined) todo.done = patch.done;
    if (patch.dueDate !== undefined) todo.dueDate = patch.dueDate;
    if (patch.listId !== undefined) todo.listId = patch.listId;

    let currentIds: number[];
    if (patch.tagIds !== undefined) {
      const ids = normalizeTagIds(patch.tagIds);
      await this.todoTags.delete({ todoId: id });
      if (ids.length > 0) {
        await this.todoTags.insert(ids.map((tagId) => ({ todoId: id, tagId })));
      }
      currentIds = ids;
    } else {
      currentIds = (await this.todoTags.find({ where: { todoId: id } }))
        .map((tt) => tt.tagId)
        .sort((a, b) => a - b);
    }

    todo.version += 1;
    todo.updatedAt = new Date();
    const saved = await this.todos.save(todo);
    // Bump AFTER the mutation — a 409 above never bumps.
    await this.cache.bumpGeneration(sub);
    return this.decodeCachedTodoRow({ ...toCachedTodoRow(saved), tagIds: currentIds }, sub, dek);
  }

  /**
   * `DELETE /api/todos/:id` — permanent (no trash in the MVP). The `todoId` FK
   * (`ON DELETE CASCADE`) removes the todo's association rows. Foreign/missing
   * ids are a byte-identical 404.
   */
  async remove(sub: string, id: string): Promise<void> {
    const result = await this.todos.delete({ id, ownerSub: sub });
    if (!result.affected) throw new NotFoundException('Todo not found');
    await this.cache.bumpGeneration(sub);
  }

  /**
   * The owner's tag usage surface (kernel `GET …/tags → [{tagId, count}]`):
   * association ids + how many todos carry each. Ids and counts only — names
   * live in `tags-service` (resolved by the BFF), so nothing here is content and
   * the `todo:tags` cache is metadata-only by design.
   */
  async listTagUsage(sub: string): Promise<TagUsage[]> {
    return this.cache.getThrough(
      sub,
      TODO_TAGS,
      async () => {
        const raw = (await this.todoTags
          .createQueryBuilder('todoTag')
          .innerJoin('todoTag.todo', 'todo')
          .select('todoTag.tagId', 'tagId')
          .addSelect('COUNT(*)', 'count')
          .where('todo.ownerSub = :sub', { sub })
          .groupBy('todoTag.tagId')
          .orderBy('todoTag.tagId', 'ASC')
          .getRawMany()) as Array<{ tagId: number | string; count: number | string }>;
        return raw.map((row) => ({ tagId: Number(row.tagId), count: Number(row.count) }));
      },
      { decode: decodeTagUsage },
    );
  }
}
