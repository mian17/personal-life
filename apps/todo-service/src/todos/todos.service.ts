import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, IsNull, Not, QueryFailedError, Repository } from 'typeorm';
import { CryptoError, ENC_PREFIX, decryptField, encryptField } from '@life/crypto';
import { decodeTagUsage, likeMatch, normalizeTagIds } from '@life/shared';
import type {
  TagUsage,
  Todo as TodoDto,
  TodoCompletion as TodoCompletionDto,
  TodoCompletionPage,
  TodoPage,
  TodoRepeat,
} from '@life/shared';
import { Todo } from './todo.entity.js';
import { TodoCompletion } from './todo-completion.entity.js';
import { TodoTag } from './todo-tag.entity.js';
import { ISO_DUE, dueSortKey, localToUtc, reminderLocal } from './due-time.js';
import {
  advanceToOnOrAfter,
  formatRepeatDays,
  nextOccurrence,
  parseRepeatDays,
} from './recurrence.js';
import {
  DEFAULT_PAGE_LIMIT,
  GrantsService,
  KeysService,
  paginate,
  runAtomicBatch,
  type Principal,
} from '@life/service-kit';
import { CreateWithOriginDto } from './dto/create-with-origin.dto.js';
import { ListsService } from '../lists/lists.service.js';
import {
  TODO_ALL,
  TODO_CACHE,
  TODO_COMPLETIONS,
  TODO_TAGS,
  TODO_TRASH,
  TodosCache,
} from '../cache/todo-cache.js';

/** A todo as a create carries it — the shape one `:batchCreate` item holds. */
type TodoDraft = {
  title: string;
  note?: string;
  dueDate?: string;
  repeat?: TodoRepeat | null;
  repeatDays?: number[] | null;
  listId?: string;
  important?: boolean | null;
  tagIds?: number[];
  /** The producer service a grant scoped this write to; `undefined` = app write. */
  originService?: string;
  /** The producer's own id for this todo; `undefined` = app write. */
  originId?: string;
};

/** A todo plus the origin columns its row persisted — the origin APIs' wire body. */
export type OriginatedTodo = TodoDto & {
  originService: string | null;
  originId: string | null;
};

/** What a producer names: the origin service its grant allows, and its own todo id. */
type OriginRef = { service: string; id: string };

/** One completion log row, ready to insert. */
type CompletionEntry = {
  ownerSub: string;
  todoId: string;
  occurrence: string;
  completedAt: string;
};

/** The `PATCH /api/todos/:id` field set, applied after the ownership/version checks. */
type TodoPatch = {
  title?: string;
  note?: string | null;
  done?: boolean;
  important?: boolean | null;
  dueDate?: string | null;
  repeat?: TodoRepeat | null;
  repeatDays?: number[] | null;
  listId?: string | null;
  tagIds?: number[];
  expectedVersion?: number;
};

/** The `dueBefore`/`dueAfter` window, evaluated in memory after the cache hit. */
function matchesDueWindow(
  dueDate: string | null,
  opts: { dueBefore?: string; dueAfter?: string },
): boolean {
  if (opts.dueBefore !== undefined && !(dueDate !== null && dueDate < opts.dueBefore)) return false;
  if (opts.dueAfter !== undefined && !(dueDate !== null && dueDate > opts.dueAfter)) return false;
  return true;
}

/** The `findAll` read filters, applied in memory after the cache hit. */
function matchesTodoFilters(
  todo: TodoDto,
  opts: {
    q?: string;
    listId?: string;
    tagId?: number;
    done?: boolean;
    important?: boolean;
    dueBefore?: string;
    dueAfter?: string;
  },
): boolean {
  if (opts.listId !== undefined && todo.listId !== opts.listId) return false;
  if (opts.tagId !== undefined && !todo.tagIds.includes(opts.tagId)) return false;
  if (opts.done !== undefined && todo.done !== opts.done) return false;
  // In memory against the computed value — never a SQL predicate, never in the key.
  if (opts.important !== undefined && todo.effectiveImportant !== opts.important) return false;
  if (!matchesDueWindow(todo.dueDate, opts)) return false;
  if (
    opts.q &&
    !likeMatch(todo.title, `%${opts.q}%`) &&
    !likeMatch(todo.note ?? '', `%${opts.q}%`)
  ) {
    return false;
  }
  return true;
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
 * so the tag filter and the DTO can run after a hit; `dueDate`/`done`/
 * `important`/`listId`/`deletedAt` are plaintext metadata (`important` is the
 * non-content importance override, `SPEC-todo-importance`). `originService`/
 * `originId` are the origin columns, plaintext metadata exactly like `listId`
 * (`SPEC-todo-origin` §11). `origin` is the reserved seam (unused).
 */
interface CachedTodoRow {
  id: string;
  title: string;
  note: string | null;
  done: boolean;
  important: boolean | null;
  dueDate: string | null;
  repeat: TodoRepeat | null;
  repeatDays: number[] | null;
  reminderScheduledAt: string | null;
  listId: string | null;
  origin: string | null;
  originService: string | null;
  originId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  tagIds: number[];
}

/** Serialize a todo entity into its ciphertext-row form (dates → ISO). */
function toCachedTodoRow(todo: Todo): CachedTodoRow {
  return {
    id: todo.id,
    title: todo.title,
    note: todo.note,
    done: todo.done,
    important: todo.important,
    dueDate: todo.dueDate,
    repeat: todo.repeat,
    repeatDays: parseRepeatDays(todo.repeatDays),
    reminderScheduledAt: todo.reminderScheduledAt,
    listId: todo.listId,
    origin: todo.origin,
    originService: todo.originService,
    originId: todo.originId,
    version: todo.version,
    createdAt: todo.createdAt.toISOString(),
    updatedAt: todo.updatedAt.toISOString(),
    deletedAt: todo.deletedAt ? todo.deletedAt.toISOString() : null,
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
  const noteOk =
    row?.note === null || (typeof row?.note === 'string' && row.note.startsWith(ENC_PREFIX));
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

/** The completion log's cached row shape — rows as persisted, no content column. */
interface CachedCompletionRow {
  id: string;
  todoId: string;
  occurrence: string;
  completedAt: string;
}

function isCompletionRow(row: CachedCompletionRow): boolean {
  return (
    typeof row?.id === 'string' &&
    typeof row?.todoId === 'string' &&
    typeof row?.occurrence === 'string' &&
    typeof row?.completedAt === 'string'
  );
}

function decodeCompletionRows(raw: unknown): CachedCompletionRow[] {
  if (!Array.isArray(raw) || !raw.every(isCompletionRow)) {
    throw new Error('cache entry is not completion rows');
  }
  return raw;
}

/** Serialize a completion entity into its cached row form (no content column). */
function toCachedCompletionRow(completion: TodoCompletion): CachedCompletionRow {
  return {
    id: completion.id,
    todoId: completion.todoId,
    occurrence: completion.occurrence,
    completedAt: completion.completedAt,
  };
}

/** A hydrated, decrypted todo plus its stable ordering key. */
interface OrderedTodo {
  dto: TodoDto;
  /** The `dueSortKey(dueDate, tz)` value or `~` for undated — the first cursor component. */
  due: string;
}

/**
 * The domain order (`SPEC-todo-service` Behaviour): due-dated ascending (overdue
 * first), undated last, `createdAt DESC` tie-break, `id DESC` as the final
 * deterministic tie-break. The dated component is the **local** `dueSortKey`
 * (`~` = undated), so a timed due sorts by the user's local day, not the UTC
 * day; `createdAt` is ISO, so it compares correctly as a string.
 */
function compareTodos(a: OrderedTodo, b: OrderedTodo): number {
  const aDated = a.due !== '~';
  const bDated = b.due !== '~';
  if (aDated && bDated && a.due !== b.due) {
    return a.due < b.due ? -1 : 1;
  }
  if (aDated !== bDated) return aDated ? -1 : 1;
  if (a.dto.createdAt !== b.dto.createdAt) {
    return a.dto.createdAt > b.dto.createdAt ? -1 : 1;
  }
  if (a.dto.id === b.dto.id) return 0;
  return a.dto.id > b.dto.id ? -1 : 1;
}

/**
 * True when `item` falls strictly after the cursor in the domain order. The
 * cursor's parts are this list's own key, `[due, createdAt, id]`.
 */
function afterCursor(item: OrderedTodo, at: string[]): boolean {
  const [cursorDue, cursorCreatedAt, cursorId] = at;
  const { dto, due } = item;
  if (cursorDue === '~') {
    // Cursor is in the undated group: only undated rows can follow.
    if (due !== '~') return false;
    return (
      dto.createdAt < cursorCreatedAt || (dto.createdAt === cursorCreatedAt && dto.id < cursorId)
    );
  }
  // Cursor is dated: undated rows always follow.
  if (due === '~') return true;
  if (due > cursorDue) return true;
  if (due < cursorDue) return false;
  return (
    dto.createdAt < cursorCreatedAt || (dto.createdAt === cursorCreatedAt && dto.id < cursorId)
  );
}

/**
 * True when a trash row falls strictly after the cursor in `deletedAt DESC, id
 * DESC` order, so a page boundary can neither repeat nor skip a row.
 */
function afterTrashCursor(item: { deletedAt: string; id: string }, at: string[]): boolean {
  const [deletedAt, id] = at;
  return item.deletedAt < deletedAt || (item.deletedAt === deletedAt && item.id < id);
}

/**
 * True when a completion row falls strictly after the cursor in `completedAt
 * DESC, id DESC` order, so a page boundary can neither repeat nor skip a row.
 */
function afterCompletionCursor(item: { completedAt: string; id: string }, at: string[]): boolean {
  const [completedAt, id] = at;
  return item.completedAt < completedAt || (item.completedAt === completedAt && item.id < id);
}

/**
 * True only for a SQLite UNIQUE-constraint failure — the guarded insert's
 * double-tick case. Any other driver error must propagate.
 */
function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof QueryFailedError &&
    ((err.driverError as { code?: string } | undefined)?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      err.message.includes('UNIQUE constraint failed'))
  );
}

@Injectable()
export class TodosService {
  private readonly logger = new Logger(TodosService.name);

  /**
   * The national IANA zone every local ⇄ UTC helper is resolved against, read
   * **once** at construction (lesson 0016: one owner for the zone lookup).
   */
  private readonly tz: string = process.env.TODO_TIMEZONE ?? 'Asia/Ho_Chi_Minh';

  constructor(
    @InjectRepository(Todo) private readonly todos: Repository<Todo>,
    @InjectRepository(TodoTag) private readonly todoTags: Repository<TodoTag>,
    @Inject(TODO_CACHE) private readonly cache: TodosCache,
    private readonly keys: KeysService,
    private readonly lists: ListsService,
    private readonly grants: GrantsService,
    @InjectDataSource() private readonly dataSource: DataSource,
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
  private decodeCachedTodoRow(
    row: CachedTodoRow,
    sub: string,
    dek: Buffer | null,
    effectiveImportant: boolean,
  ): TodoDto {
    if (!dek) {
      // Non-empty rows always carry a title envelope; a missing key cannot occur
      // on a well-formed read, and returning ciphertext would be worse.
      throw new CryptoError('missing data key for an encrypted field');
    }
    return {
      id: row.id,
      title: this.openField(row.title, dek, todoTitleAad(sub, row.id), row.id),
      note:
        row.note === null ? null : this.openField(row.note, dek, todoNoteAad(sub, row.id), row.id),
      done: row.done,
      important: row.important,
      effectiveImportant,
      dueDate: row.dueDate,
      repeat: row.repeat,
      repeatDays: row.repeatDays,
      reminderScheduledAt: row.reminderScheduledAt,
      listId: row.listId,
      tagIds: [...row.tagIds],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
      version: row.version,
    };
  }

  /** Resolve the owner DEK for a set of ciphertext rows (at most once per read). */
  private readDek(sub: string, rows: CachedTodoRow[]): Promise<Buffer | null> {
    if (rows.length === 0) return Promise.resolve(null);
    return this.keys.getDekForRead(sub);
  }

  /**
   * The list-default map for one owner, read from the **same** cached
   * `todo:lists` row-set the service already uses for list names (Contract 2
   * no-fork: no new cache instance, no second loader). Todos and lists share the
   * `todo:gen:<sub>` counter, so within a generation both cached row-sets are
   * consistent; a list write bumps the counter and both refresh together.
   *
   * Skipped when no row references a list: nothing can inherit, so the
   * `todo:lists` entry is not touched at all.
   */
  private async listDefaults(
    sub: string,
    rows: CachedTodoRow[],
  ): Promise<Map<string, boolean | null>> {
    if (!rows.some((row) => row.listId !== null)) return new Map();
    const lists = await this.lists.rawRows(sub);
    return new Map(lists.map((row) => [row.id, row.importantDefault]));
  }

  /**
   * `effectiveImportant(todo, list) = todo.important ?? list.importantDefault ??
   * false` (`SPEC-todo-importance`). Computed in the request path, **after** the
   * cache hit and decryption — never stored, never in the cache key. With
   * `defaults` omitted there is no list context, so the effective value is
   * `important ?? false` (todo has no list, or a single-row write).
   */
  private effectiveImportant(todo: CachedTodoRow, defaults?: Map<string, boolean | null>): boolean {
    const listDefault = todo.listId !== null ? (defaults?.get(todo.listId) ?? null) : null;
    return todo.important ?? listDefault ?? false;
  }

  /** The effective value for a single row, joining the owner's cached list rows. */
  private async effectiveForRow(sub: string, row: CachedTodoRow): Promise<boolean> {
    if (row.listId === null) return this.effectiveImportant(row);
    return this.effectiveImportant(row, await this.listDefaults(sub, [row]));
  }

  /**
   * Guard + normalize a due value (400 otherwise): a date-only value is stored
   * verbatim (never through `Date`, lesson 0003); a timed local
   * `YYYY-MM-DDTHH:mm` becomes its canonical UTC instant.
   */
  private normalizeDue(value: string, tz: string): string {
    if (!ISO_DUE.test(value)) {
      throw new BadRequestException('dueDate must be YYYY-MM-DD or YYYY-MM-DDTHH:mm');
    }
    return value.includes('T') ? localToUtc(value, tz).toISOString() : value;
  }

  /**
   * Enforce the custom-repeat invariant: `custom` requires a non-empty weekday
   * set; any non-custom repeat normalizes the set away to `null`
   * (`SPEC-todo-custom-repeat` D7). One owner for the rule.
   */
  private normalizeRepeat(repeat: TodoRepeat | null, days: number[] | null): number[] | null {
    if (repeat === 'custom') {
      if (!days || days.length === 0) {
        throw new BadRequestException('custom repeat requires repeatDays');
      }
      return days;
    }
    return null;
  }

  /**
   * The server-computed UTC instant a push reminder fires at: timed → the due
   * instant, date-only → 09:00 national (N5/D5). One owner for the rule
   * (lesson 0016); the stored value is re-localized with `dueSortKey` first.
   */
  private reminderAt(normalizedDue: string | null, tz: string): string | null {
    if (normalizedDue === null) return null;
    return localToUtc(reminderLocal(dueSortKey(normalizedDue, tz)), tz).toISOString();
  }

  /** The configured zone's current wall-clock, same shape the recurrence helpers compare. */
  private nowLocal(): string {
    return dueSortKey(new Date().toISOString(), this.tz);
  }

  /**
   * Advance-on-tick for a recurring todo: log the pre-advance due `D`, then move
   * the todo strictly past it and forward to on/after now, remaining open.
   */
  private async advanceOnTick(
    manager: EntityManager,
    sub: string,
    todo: Todo,
    id: string,
  ): Promise<void> {
    // Log the pre-advance due before overwriting it (occurrence = D).
    const occurrence = todo.dueDate!;
    const days = parseRepeatDays(todo.repeatDays);
    const local = dueSortKey(todo.dueDate!, this.tz);
    // Step strictly past the ticked occurrence first, then roll forward to
    // on/after now — a future-due repeat must not jam on its own due.
    const stepped = nextOccurrence(local, todo.repeat!, days);
    const next = advanceToOnOrAfter(stepped, todo.repeat!, this.nowLocal(), days);
    await this.writeCompletion(manager, sub, id, occurrence, new Date().toISOString());
    todo.dueDate = next.includes('T') ? localToUtc(next, this.tz).toISOString() : next;
    todo.reminderScheduledAt = this.reminderAt(todo.dueDate, this.tz);
    todo.done = false;
  }

  /** A non-recurring tick: log `occurrence = D ?? '~'` and close the todo. */
  private async closeOnTick(
    manager: EntityManager,
    sub: string,
    todo: Todo,
    id: string,
  ): Promise<void> {
    const occurrence = todo.dueDate ?? '~';
    await this.writeCompletion(manager, sub, id, occurrence, new Date().toISOString());
    todo.done = true;
  }

  /**
   * Undo (one rule for every todo shape): delete the newest log row. A dated
   * `occurrence` is stored in the persisted dual shape, so assigning it back
   * verbatim is the exact completed due; the `'~'` sentinel leaves the due
   * untouched. No row means `done` is the only change.
   */
  private async undoCompletion(
    manager: EntityManager,
    sub: string,
    todo: Todo,
    id: string,
  ): Promise<void> {
    const repo = manager.getRepository(TodoCompletion);
    const last = await repo.findOne({
      where: { ownerSub: sub, todoId: id },
      order: { completedAt: 'DESC' },
    });
    if (!last) {
      todo.done = false;
      return;
    }
    await repo.delete({ id: last.id, ownerSub: sub });
    if (last.occurrence !== '~') {
      todo.dueDate = last.occurrence;
      todo.reminderScheduledAt = this.reminderAt(todo.dueDate, this.tz);
    }
    todo.done = false;
  }

  private async writeCompletion(
    manager: EntityManager,
    sub: string,
    todoId: string,
    occurrence: string,
    completedAt: string,
  ): Promise<void> {
    const repo = manager.getRepository(TodoCompletion);
    const existing = await repo.findOne({ where: { todoId, occurrence } });
    if (existing) return;
    await this.insertCompletionOnce(manager, { ownerSub: sub, todoId, occurrence, completedAt });
  }

  /**
   * Insert exactly one completion row, bare. Whether this occurrence was already
   * logged is the database's answer: the UNIQUE constraint raises and that one
   * violation is swallowed, so a caller can tell the first write from the repeat
   * without ever reading the log first. Any other driver error propagates.
   */
  private async insertCompletionOnce(
    manager: EntityManager,
    entry: CompletionEntry,
  ): Promise<boolean> {
    try {
      await manager.getRepository(TodoCompletion).insert({ id: randomUUID(), ...entry });
      return true;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      return false;
    }
  }

  /** The owner's full ciphertext row-set — the one cached `todo:all` entry. */
  private rawRows(sub: string): Promise<CachedTodoRow[]> {
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
          .andWhere('todo.deletedAt IS NULL')
          .getMany();
        return found.map(toCachedTodoRow);
      },
      { decode: decodeCiphertextTodoRowList, cacheable: isCiphertextTodoRowList },
    );
  }

  /** `POST /api/todos` — 201 with `version: 0`. */
  async create(sub: string, input: TodoDraft): Promise<TodoDto> {
    const todo = await this.insertOne(this.todos.manager, sub, input);
    // Bump AFTER the insert: pre-mutation reads die here; a thrown save never bumps.
    await this.cache.bumpGeneration(sub);
    // Warm the lists entry at the new generation when this todo references a list,
    // mirroring the pre-refactor decode-after-bump so a following read does not
    // repopulate a stale generation (todo-cache.e2e-spec).
    if (todo.listId !== null) await this.lists.rawRows(sub);
    return todo;
  }

  /**
   * `POST /api/todos/origin` — a producer client creates a todo on the user's
   * behalf (`SPEC-todo-origin` §7). The write goes through the app's own create
   * path, so the owner's cache generation bumps like any app write; only
   * `originId` comes from the request, and `ownerSub` from the verified `sub`.
   */
  async createWithOrigin(
    principal: Principal,
    input: CreateWithOriginDto,
  ): Promise<OriginatedTodo> {
    const originService = await this.grantedOrigin(principal.clientId);
    const todo = await this.create(principal.sub, { ...input, originService });
    return { ...todo, originService, originId: input.originId };
  }

  /**
   * The origin the caller's verified `client_id` may write, or 403. Fail closed:
   * a token carrying no `client_id` holds no grant row, so it may not create by
   * origin at all.
   */
  private async grantedOrigin(clientId: string | null): Promise<string> {
    const originService = clientId === null ? null : await this.grants.findByClientId(clientId);
    if (originService === null) throw new ForbiddenException('No origin grant for this client');
    return originService;
  }

  /**
   * `POST /api/todos/origin/:originId/complete` — a producer ticks off the todo
   * its own create made, so the user never repeats the work
   * (`SPEC-todo-origin` §7). Idempotency is the database's, not a prior read's:
   * the first call logs the completion and closes the todo, and the repeat is a
   * swallowed UNIQUE violation that writes nothing, invalidates nothing, and
   * answers the very state the first call left.
   *
   * Recurrence never advances here (spec assumption 7): a producer closes an
   * occurrence, it does not roll a repeating todo forward.
   */
  async completeByOrigin(principal: Principal, originId: string): Promise<OriginatedTodo> {
    const origin: OriginRef = {
      service: await this.grantedOrigin(principal.clientId),
      id: originId,
    };
    const todo = await this.loadOriginTodo(principal.sub, origin);
    // The ownership resolve above is the only read; the write decides idempotency.
    const completed = await this.dataSource.transaction((manager) =>
      this.completeTodoOnce(manager, todo),
    );
    if (completed === null) return this.originatedTodoView(todo);
    // Bump AFTER a write that happened; the swallowed no-op never reaches here.
    await this.cache.bumpGeneration(principal.sub);
    return this.originatedTodoView(completed);
  }

  /**
   * The todo this origin created for this owner. Both origin columns come from the
   * grant row and the verified `sub`, so another origin's `originId` — or one the
   * app itself created — is a byte-identical 404.
   */
  private async loadOriginTodo(sub: string, origin: OriginRef): Promise<Todo> {
    const todo = await this.todos.findOne({
      where: {
        ownerSub: sub,
        originService: origin.service,
        originId: origin.id,
        deletedAt: IsNull(),
      },
    });
    if (!todo) throw new NotFoundException('Todo not found');
    return todo;
  }

  /**
   * Log this todo's completion occurrence and close it, or `null` when that
   * occurrence was already logged. `occurrence = dueDate ?? '~'` is the same
   * sentinel the app's non-recurring tick writes, so the completeness rule holds
   * for a dated and an undated todo alike.
   */
  private async completeTodoOnce(manager: EntityManager, todo: Todo): Promise<Todo | null> {
    const logged = await this.insertCompletionOnce(manager, {
      ownerSub: todo.ownerSub,
      todoId: todo.id,
      occurrence: todo.dueDate ?? '~',
      completedAt: new Date().toISOString(),
    });
    if (!logged) return null;
    todo.done = true;
    todo.updatedAt = new Date();
    return manager.save(todo);
  }

  /**
   * The wire body an origin write answers with: the decoded todo plus the origin
   * columns, read off the row exactly as it was persisted (`SPEC-todo-origin` §11).
   */
  private async originatedTodoView(todo: Todo): Promise<OriginatedTodo> {
    const tagIds = await this.resolveTagIds(this.todos.manager, todo.id, undefined);
    const dek = await this.keys.getDekForRead(todo.ownerSub);
    const decoded = await this.answerWithDecodedTodo(todo, tagIds, todo.ownerSub, dek);
    return { ...decoded, originService: todo.originService, originId: todo.originId };
  }

  /** The `todos` batch create: one transaction, submission order, one bump (MAP §4). */
  async createMany(sub: string, items: TodoDraft[]): Promise<TodoDto[]> {
    const results = await runAtomicBatch({
      items,
      sub,
      dataSource: this.dataSource,
      cache: this.cache,
      runItem: (item, manager) => this.insertOne(manager, sub, item),
    });
    if (results.some((todo) => todo.listId !== null)) await this.lists.rawRows(sub);
    return results;
  }

  /**
   * One todo's insert, through the manager the caller supplies, and with no bump.
   * The singular route passes the repository's manager and keeps its own bump; a
   * batch passes the transaction's manager, so the kernel owns one bump for the
   * whole request.
   */
  private async insertOne(manager: EntityManager, sub: string, input: TodoDraft): Promise<TodoDto> {
    const todos = manager.getRepository(Todo);
    const todoTags = manager.getRepository(TodoTag);
    const dueDate = input.dueDate == null ? null : this.normalizeDue(input.dueDate, this.tz);
    const repeat = input.repeat ?? null;
    if (repeat !== null && dueDate === null) {
      throw new BadRequestException('repeat requires a dueDate');
    }
    const days = this.normalizeRepeat(repeat, input.repeatDays ?? null);
    if (input.listId !== undefined) await this.lists.assertOwnedList(sub, input.listId);

    const id = randomUUID();
    const ids = normalizeTagIds(input.tagIds);
    const dek = await this.keys.getOrCreateDek(sub);
    const now = new Date();
    const todo = todos.create({
      id,
      title: encryptField(dek, input.title, todoTitleAad(sub, id)),
      note: input.note === undefined ? null : encryptField(dek, input.note, todoNoteAad(sub, id)),
      done: false,
      // Omitted or `null` both store `null` (inherit the list default).
      important: input.important ?? null,
      dueDate,
      repeat,
      repeatDays: formatRepeatDays(days),
      reminderScheduledAt: this.reminderAt(dueDate, this.tz),
      listId: input.listId ?? null,
      origin: null,
      originService: input.originService ?? null,
      originId: input.originId ?? null,
      ownerSub: sub,
      version: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    const saved = await this.insertTodo(todos, todo);
    // Association rows are managed explicitly (TagRef joins, not a cascade
    // relation) so a write stores exactly the ids it carries.
    if (ids.length > 0) {
      await todoTags.insert(ids.map((tagId) => ({ todoId: id, tagId })));
    }
    const row = { ...toCachedTodoRow(saved), tagIds: ids };
    return this.decodeCachedTodoRow(row, sub, dek, await this.effectiveForRow(sub, row));
  }

  /**
   * Insert one row. A repeated `(originService, originId)` is the database's
   * answer, not a prior SELECT's: the unique constraint raises, and only that
   * one violation becomes a 409 (`SPEC-todo-origin` §5).
   */
  private async insertTodo(todos: Repository<Todo>, todo: Todo): Promise<Todo> {
    try {
      return await todos.save(todo);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      throw new ConflictException('This origin id was already used for this service');
    }
  }

  /**
   * `GET /api/todos` — cursor page over the domain order with every filter
   * applied in memory after the cache hit. One `todo:all` entry serves every
   * `q`/`tagId`/`listId`/`done`/`important`/`due*`/cursor/limit variant.
   */
  async findAll(
    sub: string,
    opts: {
      q?: string;
      listId?: string;
      tagId?: number;
      done?: boolean;
      important?: boolean;
      dueBefore?: string;
      dueAfter?: string;
      limit?: number;
      cursor?: string;
    },
  ): Promise<TodoPage> {
    const limit = opts.limit ?? DEFAULT_PAGE_LIMIT;
    const rows = await this.rawRows(sub);
    const dek = await this.readDek(sub, rows);
    // One join against the owner's cached `todo:lists` row-set serves the whole
    // page; `effectiveImportant` is computed post-decrypt, never cached/stored.
    const defaults = await this.listDefaults(sub, rows);
    const decoded = rows.map((row) =>
      this.decodeCachedTodoRow(row, sub, dek, this.effectiveImportant(row, defaults)),
    );

    const filtered = decoded.filter((todo) => matchesTodoFilters(todo, opts));

    const ordered: OrderedTodo[] = filtered.map((dto) => ({
      dto,
      due: dueSortKey(dto.dueDate, this.tz),
    }));
    ordered.sort(compareTodos);

    const {
      rows: page,
      nextCursor,
      total,
    } = paginate(ordered, {
      limit,
      cursor: opts.cursor,
      // `due` is the local `dueSortKey` (`~` = undated) and the first key part, so
      // the cursor carries the domain order the rows were sorted into.
      keyOf: (item) => [item.due, item.dto.createdAt, item.dto.id],
      after: afterCursor,
    });
    return { todos: page.map((item) => item.dto), nextCursor, total };
  }

  /**
   * `GET /api/todos/trash` — the owner's trashed rows through the read-through
   * cache under the reserved rest key `todo:trash` (one entry serves every
   * cursor/limit variant). Cached value = serialized ciphertext rows as stored;
   * decrypt, order (`deletedAt DESC, id DESC`) and keyset-paginate in memory
   * after the hit. The loader lives inside `getThrough` (Contract 2 Rule 1).
   */
  async findTrash(sub: string, opts: { limit?: number; cursor?: string }): Promise<TodoPage> {
    const limit = opts.limit ?? DEFAULT_PAGE_LIMIT;
    const rows = await this.cache.getThrough(
      sub,
      TODO_TRASH,
      async () => {
        // Metadata-only SQL: trashed rows only, in the `deletedAt DESC, id DESC`
        // order; pagination runs in memory after decryption so a same-timestamp
        // tie can never repeat or skip the boundary row.
        const found = await this.todos
          .createQueryBuilder('todo')
          .leftJoinAndSelect('todo.todoTags', 'todoTag')
          .where('todo.deletedAt IS NOT NULL')
          .andWhere('todo.ownerSub = :sub', { sub })
          .orderBy('todo.deletedAt', 'DESC')
          .addOrderBy('todo.id', 'DESC')
          .getMany();
        return found.map(toCachedTodoRow);
      },
      { decode: decodeCiphertextTodoRowList, cacheable: isCiphertextTodoRowList },
    );

    const dek = await this.readDek(sub, rows);
    const defaults = await this.listDefaults(sub, rows);
    // The loader guarantees `deletedAt` is set on every row; the type guard
    // narrows that for the cursor helpers without an assertion.
    const decoded = rows
      .map((row) => this.decodeCachedTodoRow(row, sub, dek, this.effectiveImportant(row, defaults)))
      .filter((todo): todo is TodoDto & { deletedAt: string } => todo.deletedAt !== null);
    const desc = (a: string, b: string) => {
      if (a === b) return 0;
      return a < b ? 1 : -1;
    };
    const ordered = [...decoded].sort((a, b) => desc(a.deletedAt, b.deletedAt) || desc(a.id, b.id));

    const {
      rows: page,
      nextCursor,
      total,
    } = paginate(ordered, {
      limit,
      cursor: opts.cursor,
      keyOf: (item) => [item.deletedAt, item.id],
      after: afterTrashCursor,
    });
    return { todos: page, nextCursor, total };
  }

  /**
   * `GET /api/todos/completions` — the owner's completion log through the
   * read-through cache under the rest key `todo:completions` (one entry serves
   * every cursor/limit variant). Cached value = serialized completion rows as
   * stored; the title/list join runs post-hit from the same cached `todo:all`
   * row-set (`C7` — never a snapshot). A completion whose todo is no longer
   * active (trashed) is omitted; a permanently deleted todo already cascaded
   * its rows. Order `completedAt DESC, id DESC`, keyset-paginated in memory.
   */
  async findCompletions(
    sub: string,
    opts: { limit?: number; cursor?: string },
  ): Promise<TodoCompletionPage> {
    const limit = opts.limit ?? DEFAULT_PAGE_LIMIT;
    const rows = await this.cache.getThrough(
      sub,
      TODO_COMPLETIONS,
      async () => {
        const found = await this.dataSource
          .getRepository(TodoCompletion)
          .createQueryBuilder('c')
          .where('c.ownerSub = :sub', { sub })
          .orderBy('c.completedAt', 'DESC')
          .addOrderBy('c.id', 'DESC')
          .getMany();
        return found.map(toCachedCompletionRow);
      },
      { decode: decodeCompletionRows },
    );

    const todoRows = await this.rawRows(sub);
    const dek = await this.readDek(sub, todoRows);
    const byId = new Map(todoRows.map((row) => [row.id, row]));
    const joined = rows.filter((row) => byId.has(row.todoId));

    const desc = (a: string, b: string) => {
      if (a === b) return 0;
      return a < b ? 1 : -1;
    };
    const ordered = [...joined].sort(
      (a, b) => desc(a.completedAt, b.completedAt) || desc(a.id, b.id),
    );
    const {
      rows: page,
      nextCursor,
      total,
    } = paginate(ordered, {
      limit,
      cursor: opts.cursor,
      keyOf: (row) => [row.completedAt, row.id],
      after: afterCompletionCursor,
    });

    // Resolve list names only when a page row is actually listed.
    const listedIds = new Set(
      page
        .map((row) => byId.get(row.todoId)!.listId)
        .filter((listId): listId is string => listId !== null),
    );
    const names = new Map<string, string>();
    if (listedIds.size > 0) {
      for (const list of await this.lists.list(sub)) names.set(list.id, list.name);
    }

    const completions: TodoCompletionDto[] = page.map((row) => {
      const todo = byId.get(row.todoId)!;
      return {
        id: row.id,
        todoId: row.todoId,
        occurrence: row.occurrence,
        completedAt: row.completedAt,
        title: this.openField(todo.title, dek!, todoTitleAad(sub, row.todoId), row.todoId),
        listId: todo.listId,
        listName: todo.listId !== null ? (names.get(todo.listId) ?? null) : null,
      };
    });
    return { completions, nextCursor, total };
  }

  /**
   * `GET /api/todos/:id` — served from the one cached `todo:all` row-set (the
   * spec enumerates exactly four todo cache shapes; the id is a filter, so no
   * id ever enters the key space). Decrypt, then slice by id in memory after the
   * hit. A foreign or missing id is a byte-identical 404 — the `rawRows` loader
   * guards `deletedAt IS NULL`, so a trashed id reads as absent.
   */
  async findOne(sub: string, id: string): Promise<TodoDto> {
    const rows = await this.rawRows(sub);
    const dek = await this.readDek(sub, rows);
    const found = rows.find((row) => row.id === id);
    if (!found) throw new NotFoundException('Todo not found');
    return this.decodeCachedTodoRow(found, sub, dek, await this.effectiveForRow(sub, found));
  }

  /**
   * `PATCH /api/todos/:id` — partial update. An omitted field is unchanged
   * (last-write-wins); explicit `null` clears `note`/`dueDate`/`listId` and
   * resets `important` to inherit; a `tagIds` write REPLACES the association
   * set; a stale `expectedVersion` is 409. Foreign/missing ids are a
   * byte-identical 404.
   *
   * A due patch is normalized (timed → canonical instant) and the reminder is
   * recomputed whenever the due or the repeat changes. Clearing the due clears
   * both the repeat and the reminder. Ticking a recurring todo records a
   * completion for the pre-advance due `D` and advances strictly past it, to the
   * next occurrence on/after now, remaining open (`done: false`). A
   * non-recurring `done: true` logs `occurrence = D ?? '~'` and closes it.
   * `done: false` undoes the latest completion for any todo shape: it deletes
   * that todo's newest log row and, when that row's occurrence is a real date,
   * restores it as the due (verbatim — the persisted dual shape) and re-arms the
   * reminder; the `'~'` sentinel leaves the due untouched (N2/N3).
   */
  async update(sub: string, id: string, patch: TodoPatch): Promise<TodoDto> {
    // The singular route owns its transaction, because a `done` patch writes the
    // flag, the completion log and the advance as one unit.
    const todo = await this.dataSource.transaction((manager) =>
      this.updateOne(manager, sub, id, patch),
    );
    // Bump AFTER save/commit — a 409 above never bumps, a thrown transaction
    // never reaches here.
    await this.cache.bumpGeneration(sub);
    if (todo.listId !== null) await this.lists.rawRows(sub);
    return todo;
  }

  /**
   * The `todos` batch update: one transaction, submission order, one bump. A
   * stale `expectedVersion` on any item throws `409` and rolls the whole batch
   * back, so the items before it are unchanged too.
   */
  async updateMany(sub: string, items: (TodoPatch & { id: string })[]): Promise<TodoDto[]> {
    const results = await runAtomicBatch({
      items,
      sub,
      dataSource: this.dataSource,
      cache: this.cache,
      runItem: (item, manager) => this.updateOne(manager, sub, item.id, item),
    });
    if (results.some((todo) => todo.listId !== null)) await this.lists.rawRows(sub);
    return results;
  }

  /**
   * One todo's patch, through the manager the caller supplies, and with no bump.
   *
   * Every write this performs goes through `manager`, the `done`-tick completion
   * rows included, and it never opens a transaction of its own: the singular
   * route opens one above it and a batch arrives inside the kernel's, so a second
   * one here would nest and break atomicity.
   */
  private async updateOne(
    manager: EntityManager,
    sub: string,
    id: string,
    patch: TodoPatch,
  ): Promise<TodoDto> {
    const todo = await this.loadForUpdate(manager, sub, id, patch);
    // Write path: always envelopes. Re-encrypting with a fresh nonce is correct
    // even when the plaintext is unchanged.
    const dek = await this.keys.getOrCreateDek(sub);
    this.applyContentPatch(todo, patch, dek, sub, id);

    const { dueChanged, repeatChanged } = this.applyDuePatch(todo, patch);

    // Advance-on-tick: a recurring tick moves the todo to its next occurrence
    // and keeps it open; a non-recurring `done:true` closes it. The mutation
    // itself (flag + completion log + advance) is written below.
    const advance = patch.done === true && todo.repeat !== null && todo.dueDate !== null;

    // The repeat-requires-due invariant holds against the resulting due.
    if (todo.repeat !== null && todo.dueDate === null) {
      throw new BadRequestException('repeat requires a dueDate');
    }
    // Recompute the reminder when the due or the repeat moved it (the advance
    // path set it above).
    if (!advance && (dueChanged || repeatChanged)) {
      todo.reminderScheduledAt = this.reminderAt(todo.dueDate, this.tz);
    }

    const currentIds = await this.resolveTagIds(manager, id, patch.tagIds);

    todo.version += 1;
    todo.updatedAt = new Date();
    const saved = await this.savePatch(manager, todo, patch, sub, id, advance);
    return this.answerWithDecodedTodo(saved, currentIds, sub, dek);
  }

  /** The wire DTO for a just-saved todo, assembled after the write, not inside it. */
  private async answerWithDecodedTodo(
    saved: Todo,
    tagIds: number[],
    sub: string,
    dek: Buffer,
  ): Promise<TodoDto> {
    const row = { ...toCachedTodoRow(saved), tagIds };
    return this.decodeCachedTodoRow(row, sub, dek, await this.effectiveForRow(sub, row));
  }

  /** Load + authorise a PATCH target (a foreign id and a missing one are one 404). */
  private async loadForUpdate(
    manager: EntityManager,
    sub: string,
    id: string,
    patch: TodoPatch,
  ): Promise<Todo> {
    if (patch.listId !== undefined && patch.listId !== null) {
      await this.lists.assertOwnedList(sub, patch.listId);
    }
    // Load WITHOUT the relation: associations are managed explicitly by the caller.
    const todo = await manager
      .getRepository(Todo)
      .findOne({ where: { id, ownerSub: sub, deletedAt: IsNull() } });
    if (!todo) throw new NotFoundException('Todo not found');
    if (patch.expectedVersion !== undefined && todo.version !== patch.expectedVersion) {
      throw new ConflictException('Todo was modified');
    }
    return todo;
  }

  /** Seal the scalar content/metadata fields a PATCH carries. */
  private applyContentPatch(
    todo: Todo,
    patch: TodoPatch,
    dek: Buffer,
    sub: string,
    id: string,
  ): void {
    if (patch.title !== undefined) {
      todo.title = encryptField(dek, patch.title, todoTitleAad(sub, id));
    }
    if (patch.note !== undefined) {
      todo.note = patch.note === null ? null : encryptField(dek, patch.note, todoNoteAad(sub, id));
    }
    // Explicit `null` clears the override back to inherit.
    if (patch.important !== undefined) todo.important = patch.important;
    if (patch.listId !== undefined) todo.listId = patch.listId;
  }

  /**
   * Resolve the resulting due/repeat, normalizing a timed due. Clearing the due
   * clears the repeat, the custom day set and the reminder. A repeat-day write
   * applies to the resulting repeat: a repeat change without days clears days, a
   * days change without repeat keeps the committed repeat.
   */
  private applyDuePatch(
    todo: Todo,
    patch: TodoPatch,
  ): { dueChanged: boolean; repeatChanged: boolean } {
    const dueChanged = patch.dueDate !== undefined;
    const repeatChanged = patch.repeat !== undefined || patch.repeatDays !== undefined;
    if (patch.dueDate !== undefined) {
      todo.dueDate = patch.dueDate === null ? null : this.normalizeDue(patch.dueDate, this.tz);
      if (patch.dueDate === null) {
        todo.repeat = null;
        todo.repeatDays = null;
      }
    }
    if (patch.repeat !== undefined) todo.repeat = patch.repeat ?? null;
    if (repeatChanged) {
      todo.repeatDays = formatRepeatDays(
        this.normalizeRepeat(todo.repeat, patch.repeatDays ?? null),
      );
    }
    return { dueChanged, repeatChanged };
  }

  /** Replace the association set on a `tagIds` write, else read the committed one. */
  private async resolveTagIds(
    manager: EntityManager,
    todoId: string,
    tagIds: number[] | undefined,
  ): Promise<number[]> {
    const todoTags = manager.getRepository(TodoTag);
    if (tagIds === undefined) {
      return (await todoTags.find({ where: { todoId } }))
        .map((todoTag) => todoTag.tagId)
        .sort((a, b) => a - b);
    }
    const ids = normalizeTagIds(tagIds);
    await todoTags.delete({ todoId });
    if (ids.length > 0) {
      await todoTags.insert(ids.map((tagId) => ({ todoId, tagId })));
    }
    return ids;
  }

  /**
   * Persist the row through `manager`. A `done` patch also mutates the flag, the
   * completion log and the advance, and those writes ride the same manager, so
   * they commit or roll back with the row.
   */
  private async savePatch(
    manager: EntityManager,
    todo: Todo,
    patch: TodoPatch,
    sub: string,
    id: string,
    advance: boolean,
  ): Promise<Todo> {
    // A patch that carries no `done` moves no completion log, so the row alone
    // is the write.
    if (patch.done === undefined) return manager.save(todo);
    if (advance) await this.advanceOnTick(manager, sub, todo, id);
    else if (patch.done === true) await this.closeOnTick(manager, sub, todo, id);
    else await this.undoCompletion(manager, sub, todo, id);
    return manager.save(todo);
  }

  /**
   * `DELETE /api/todos/:id` — **soft** delete to trash. Sets `deletedAt` and
   * leaves `version` untouched (trash verbs never bump OCC, L2). Foreign/missing
   * ids are a byte-identical 404; a failed mutation never bumps the generation.
   */
  async remove(sub: string, id: string): Promise<void> {
    await this.softDeleteOne(this.todos.manager, sub, id);
    // Bump AFTER the mutation: pre-mutation entries die here. No version change.
    await this.cache.bumpGeneration(sub);
  }

  /**
   * The `todos` batch delete: one transaction, submission order, one bump, and
   * the singular route's soft-delete meaning. The ids come back for per-item
   * confirmation without a partial-success envelope; a foreign id is `404` and
   * rolls the whole batch back, leaving every row live.
   */
  async removeMany(sub: string, items: { id: string }[]): Promise<{ deleted: string[] }> {
    const deleted = await runAtomicBatch({
      items,
      sub,
      dataSource: this.dataSource,
      cache: this.cache,
      runItem: async (item, manager) => {
        await this.softDeleteOne(manager, sub, item.id);
        return item.id;
      },
    });
    return { deleted };
  }

  /**
   * One todo's move to trash, through the manager the caller supplies, and with
   * no bump. Soft by definition — `deletedAt` is set and `version` is untouched —
   * so a batch delete means exactly what the singular delete means and the row
   * stays restorable.
   */
  private async softDeleteOne(manager: EntityManager, sub: string, id: string): Promise<void> {
    const todos = manager.getRepository(Todo);
    const todo = await todos.findOne({ where: { id, ownerSub: sub, deletedAt: IsNull() } });
    if (!todo) throw new NotFoundException('Todo not found');
    todo.deletedAt = new Date();
    await todos.save(todo);
  }

  /**
   * `POST /api/todos/:id/restore` — clear `deletedAt` on one trashed row and
   * return the decoded DTO. Preserves `createdAt`, tags and `version` (L2).
   * Foreign/missing/non-trashed ids are a byte-identical 404.
   */
  async restore(sub: string, id: string): Promise<TodoDto> {
    const todo = await this.todos.findOne({
      where: { id, ownerSub: sub, deletedAt: Not(IsNull()) },
      relations: { todoTags: true },
    });
    if (!todo) throw new NotFoundException('Todo not found');
    todo.deletedAt = null;
    const saved = await this.todos.save(todo);
    await this.cache.bumpGeneration(sub);
    const row = toCachedTodoRow(saved);
    const dek = await this.readDek(sub, [row]);
    return this.decodeCachedTodoRow(row, sub, dek, await this.effectiveForRow(sub, row));
  }

  /**
   * `DELETE /api/todos/:id/permanent` — hard-delete one trashed row; the
   * `todoId` FK (`ON DELETE CASCADE`) removes its association rows. Foreign/
   * missing/non-trashed ids are a byte-identical 404.
   */
  async removePermanent(sub: string, id: string): Promise<void> {
    const result = await this.todos.delete({ id, ownerSub: sub, deletedAt: Not(IsNull()) });
    if (!result.affected) throw new NotFoundException('Todo not found');
    // Only a successful delete reaches the bump.
    await this.cache.bumpGeneration(sub);
  }

  /** `DELETE /api/todos/trash` — hard-delete every trashed row the caller owns. */
  async emptyTrash(sub: string): Promise<{ count: number }> {
    const result = await this.todos.delete({ ownerSub: sub, deletedAt: Not(IsNull()) });
    await this.cache.bumpGeneration(sub);
    return { count: result.affected ?? 0 };
  }

  /**
   * The reminders sweep's clear seam (`SPEC-todo-service`, D7). The sweep holds
   * its own read-only repository handle and never **writes** the todo table; it
   * calls this method to clear a fired reminder, so the owner's cache is
   * invalidated through the existing generation counter (Contract 2 Rule 1).
   * Unconditional and idempotent: a row whose reminder is already null is left
   * as-is, and the bump still runs after the write.
   */
  async markReminded(sub: string, id: string): Promise<void> {
    await this.todos.update({ id, ownerSub: sub }, { reminderScheduledAt: null });
    await this.cache.bumpGeneration(sub);
  }

  /**
   * The owner's tag usage surface (kernel `GET …/tags → [{tagId, count}]`):
   * association ids + how many todos carry each. Ids and counts only — names
   * live in `tags-service` (resolved by the BFF), so nothing here is content and
   * the `todo:tags` cache is metadata-only by design.
   */
  listTagUsage(sub: string): Promise<TagUsage[]> {
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
          .andWhere('todo.deletedAt IS NULL')
          .groupBy('todoTag.tagId')
          .orderBy('todoTag.tagId', 'ASC')
          .getRawMany()) as Array<{ tagId: number | string; count: number | string }>;
        return raw.map((row) => ({ tagId: Number(row.tagId), count: Number(row.count) }));
      },
      { decode: decodeTagUsage },
    );
  }
}
