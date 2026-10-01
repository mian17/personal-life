export { likeMatch } from './like-match';
export { resolveDbPath } from './db-path';

/**
 * `TagRef` — the ecosystem tag vocabulary reference (`SPEC-service-kernel`).
 * note-service no longer owns tag names; it stores exactly the integer ids a
 * write carries (association-only `note_tag` rows). Names live solely in
 * `tags-service` and are resolved by the app (BFF composition, MAP M4).
 */
export interface TagRef {
  tagId: number;
}

/**
 * A domain's tag usage surface (`GET …/tags → [{tagId, count}]`): the used ids
 * plus how many of the owner's rows carry each. Ids and counts only — no names.
 */
export interface TagUsage {
  tagId: number;
  count: number;
}

export interface Note {
  id: string;
  body: string;
  tagIds: number[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  version: number;
}

export interface CreateNoteInput {
  body: string;
  tagIds?: number[];
}

export interface UpdateNoteInput {
  body?: string;
  tagIds?: number[];
  expectedVersion?: number;
}

export interface NotePage {
  notes: Note[];
  nextCursor: string | null;
}

export const NOTE_BODY_MAX = 20000;
export const TAG_NAME_MAX = 50;

/**
 * The todo domain wire contract (`SPEC-todo-service`), owned by
 * `apps/todo-service` and consumed by clients (`apps/app`, T8) — the app never
 * re-declares these (the `Note`/`CreateNoteInput` precedent). Todos carry
 * `title`/`note` as decrypted plaintext on the wire; the service stores
 * `enc.v1.` envelopes at rest. `dueDate` is plaintext metadata (`YYYY-MM-DD`);
 * `tagIds` are registry-owned `TagRef` ids (names resolve through
 * `tags-service`); `version` is the kernel concurrency counter.
 *
 * `important`/`effectiveImportant` are the manual importance signal
 * (`SPEC-todo-importance`): `important` is the stored override (`null` =
 * inherit the list default) and `effectiveImportant` is the computed
 * `important ?? list.importantDefault ?? false`, always present on read.
 *
 * `origin` is a reserved orchestrator-seam column on todo rows
 * (`SPEC-service-kernel`) — nothing populates it in this chapter, so it is
 * deliberately absent from the wire DTO.
 */
export interface Todo {
  id: string;
  title: string;
  note: string | null;
  done: boolean;
  important: boolean | null;
  effectiveImportant: boolean;
  dueDate: string | null;
  listId: string | null;
  tagIds: number[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  version: number;
}

export interface CreateTodoInput {
  title: string;
  note?: string;
  dueDate?: string;
  listId?: string;
  /** `null` (or omitted) = inherit the list default. */
  important?: boolean | null;
  tagIds?: number[];
}

export interface UpdateTodoInput {
  title?: string;
  /** `null` clears the note; omitting leaves it unchanged. */
  note?: string | null;
  done?: boolean;
  /** `null` clears the override back to inherit; omitting leaves it unchanged. */
  important?: boolean | null;
  /** `null` clears the due date; omitting leaves it unchanged. */
  dueDate?: string | null;
  /** `null` detaches the list; omitting leaves it unchanged. */
  listId?: string | null;
  /** A `tagIds` write REPLACES the association set (kernel detach semantics). */
  tagIds?: number[];
  expectedVersion?: number;
}

export interface TodoPage {
  todos: Todo[];
  nextCursor: string | null;
}

/**
 * A todo-local list (`SPEC-todo-service`); `version` is the OCC counter.
 * `importantDefault` is the list's importance default (`null` = false), used as
 * the fallback in `Todo.effectiveImportant` (`SPEC-todo-importance`).
 */
export interface List {
  id: string;
  name: string;
  importantDefault: boolean | null;
  version: number;
  createdAt: string;
}

export const TODO_TITLE_MAX = 500;
export const TODO_NOTE_MAX = 20000;
export const TODO_LIST_NAME_MAX = 100;
