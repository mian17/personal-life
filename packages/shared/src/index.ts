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

export const TODO_REPEATS = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly', 'custom'] as const;
export type TodoRepeat = (typeof TODO_REPEATS)[number];

/** The valid custom-repeat day domain (`ISO` weekdays 1..7, Mon..Sun). */
export const TODO_REPEAT_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

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
  repeat: TodoRepeat | null;
  /** ISO weekdays 1..7 (Mon..Sun); `null` = not a custom repeat. */
  repeatDays: number[] | null;
  reminderScheduledAt: string | null;
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
  repeat?: TodoRepeat | null;
  /**
   * ISO weekdays 1..7 (Mon..Sun); `null`/omitted = no custom days. Present only
   * meaningful when `repeat === 'custom'`.
   */
  repeatDays?: number[] | null;
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
  /** `null` clears the repeat; omitting leaves it unchanged. */
  repeat?: TodoRepeat | null;
  /**
   * ISO weekdays 1..7 (Mon..Sun); `null`/omitted = no custom days. Present only
   * meaningful when `repeat === 'custom'`.
   */
  repeatDays?: number[] | null;
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

/** One appended completion occurrence (`SPEC-todo-completion-history`, C2/C6/C7). */
export interface TodoCompletion {
  id: string;
  todoId: string;                       // link to the live definition (edit screen)
  occurrence: string;                   // the satisfied due, or '~' (undated one-off)
  completedAt: string;                  // canonical UTC instant of the tick
  title: string;                        // DECRYPTED, joined at read time (C7 — never a snapshot)
  listId: string | null;                // the todo's list at read time
  listName: string | null;              // DECRYPTED list name; null when unlisted
}

export interface TodoCompletionPage {
  completions: TodoCompletion[];
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

/** The feedback domain wire contract (`SPEC-feedback-service`, `SPEC-feedback-ui`). */
export const FEEDBACK_TYPE_VALUES = ['feature_request', 'enhancement', 'bug_report'] as const;
export type FeedbackType = (typeof FEEDBACK_TYPE_VALUES)[number];

export const FEEDBACK_APPS = ['notes', 'todos', 'meals', 'feedback'] as const;
export type FeedbackApp = (typeof FEEDBACK_APPS)[number];

/**
 * The feedback status workflow's fixed vocabulary (`SPEC-feedback-status`):
 * `open` on submit, then any status to any other via the owner's dropdown — no
 * transition graph. Status is plaintext workflow metadata like `app`/`type`,
 * never `enc.v1.` content, so this constant is the one home the DB CHECK and the
 * DTO's `@IsIn` both read (lesson 0016).
 */
export const FEEDBACK_STATUS_VALUES = ['open', 'in_progress', 'done', 'wont_do'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUS_VALUES)[number];

export const FEEDBACK_TITLE_MAX = 200;
export const FEEDBACK_DESCRIPTION_MAX = 2000;

export interface FeedbackDto {
  id: string;
  app: string;
  type: string;
  status: FeedbackStatus;
  title: string;
  description: string;
  createdAt: string;
}

export interface CreateFeedbackInput {
  id: string;
  app: FeedbackApp;
  type: FeedbackType;
  title: string;
  description: string;
}

export type FeedbackSubmitResult = { ok: true; id: string } | { ok: false; message: string };

export interface PushSubscribeInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
