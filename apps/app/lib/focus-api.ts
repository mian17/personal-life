import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { ApiError, callService } from './client';

/** One recorded focus block, as `focus-service` serves it (`SPEC-focus-service` §1). */
export interface SessionRow {
  id: string;
  /** Nullable in the column (legacy rows may predate the owner stamp); every served row carries the caller's `sub`. */
  ownerSub: string | null;
  date: string;
  minutes: number;
  /**
   * The task this block worked on, as todo-service's id and nothing else — the row
   * stores no title, date or done flag, so a reader resolves the id itself.
   */
  todoId: string | null;
  /** When the owner answered the "done?" question; `null` means it is still owed. */
  todoAnsweredAt: string | null;
  createdAt: string;
}

/** One page of the owner's sessions, oldest first (`SPEC-pagination-seam` §4). */
export interface SessionPage {
  sessions: SessionRow[];
  nextCursor: string | null;
}

/**
 * One dated goal row, as served: the day it takes effect on and the daily
 * minutes. A later set replaces its own day's row only, so past days keep the
 * goal that applied then; the day→goal resolution belongs to the app, not here.
 */
export interface GoalRow {
  validFrom: string;
  minutes: number;
}

/** One page of the owner's goal history, oldest first (`SPEC-pagination-seam` §4). */
export interface GoalPage {
  goals: GoalRow[];
  nextCursor: string | null;
}

const FOCUS_API_URL = process.env.FOCUS_API_URL ?? 'http://127.0.0.1:3107';

function call<T>(path: string, init?: RequestInit): Promise<T> {
  return callService<T>(FOCUS_API_URL, path, init);
}

/**
 * `GET /api/sessions?from=&to=` — one page of the owner's raw rows between two
 * client days, oldest first. Both bounds are the caller's (`getToday()` and the
 * bucket window), so the range enters the query string rather than being derived
 * from a clock here; `cursor` is opaque and passed back untouched.
 */
export function fetchSessionPage(from: string, to: string, cursor?: string): Promise<SessionPage> {
  const query = new URLSearchParams({ from, to });
  if (cursor !== undefined) query.set('cursor', cursor);
  return call<SessionPage>(`/api/sessions?${query}`);
}

/**
 * Every session in `[from, to]`, oldest first — the whole window, not one page.
 *
 * The stats screen aggregates rows into buckets (`bucketsFor`), so a single page
 * would silently under-count every bucket past the first 50 rows. The walk follows
 * the service cursor to exhaustion; the order is stable across pages, so the
 * collected list is the same order one unpaged read would have produced.
 */
export function listSessions(from: string, to: string): Promise<SessionRow[]> {
  return collectSessionWindow(fetchSessionPage.bind(null, from, to));
}

/**
 * `POST /api/sessions` — one recorded block for the caller's own day, optionally
 * naming the task it worked on.
 *
 * `todoId` is omitted rather than sent as `null` when no task was chosen: the service's
 * DTO takes an optional bounded string, and an explicit null would be a second spelling
 * of "no task" for no gain.
 */
export function recordSession(date: string, minutes: number, todoId?: string): Promise<SessionRow> {
  return call<SessionRow>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ date, minutes, ...(todoId === undefined ? {} : { todoId }) }),
  });
}

/**
 * `POST /api/sessions/:id/answer` — the owner answered, either way, the question this
 * block's task raised.
 *
 * It records the answer only. Ticking the task is the owner's own
 * `PATCH /api/todos/:id` (`todo-api.updateTodo`): the owner is the actor, so that needs
 * no grant and focus-service never writes a todo.
 */
export function answerFocusQuestion(sessionId: string): Promise<SessionRow> {
  return call<SessionRow>(`/api/sessions/${sessionId}/answer`, { method: 'POST' });
}

/**
 * `GET /api/goal` — one page of the owner's goal history, oldest first; `cursor`
 * is opaque and passed back untouched.
 */
export function fetchGoalPage(cursor?: string): Promise<GoalPage> {
  const query = cursor === undefined ? '' : `?${new URLSearchParams({ cursor })}`;
  return call<GoalPage>(`/api/goal${query}`);
}

/**
 * Every goal row the owner has, oldest first — the whole history, never one page.
 *
 * This is the set `resolveGoal(goals, day)` resolves against, and that function
 * answers "the newest row at or before `day`". Handed a single page it would
 * resolve the wrong goal — silently, with a plausible number — for any day whose
 * governing row fell past the page boundary. Paging here is a wire concern only;
 * the consumer needs the complete history.
 */
export function listGoals(): Promise<GoalRow[]> {
  return collectGoalHistory(fetchGoalPage);
}

/** `PUT /api/goal` — set the goal effective on `date`, replacing only that day's row. */
export function setGoal(date: string, minutes: number): Promise<GoalRow> {
  return call<GoalRow>('/api/goal', {
    method: 'PUT',
    body: JSON.stringify({ date, minutes }),
  });
}

/**
 * A runaway guard, not a page limit: the walk stops here only if the service keeps
 * handing back cursors that never end. Ten thousand recorded blocks is about a
 * decade of three-a-day sessions, and 10 000 goal rows is decades of daily changes.
 * ponytail: a fixed ceiling instead of a range query; revisit when an owner
 * legitimately holds more than this inside one window.
 */
const COLLECT_CEILING = 10_000;

/** Follow the session cursor to exhaustion (or the ceiling), preserving the service order. */
async function collectSessionWindow(
  fetchPage: (cursor?: string) => Promise<SessionPage>,
): Promise<SessionRow[]> {
  const collected: SessionRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    collected.push(...page.sessions);
    if (collected.length >= COLLECT_CEILING || !page.nextCursor) {
      return collected.slice(0, COLLECT_CEILING);
    }
    cursor = page.nextCursor;
  }
}

/** Follow the goal cursor to exhaustion (or the ceiling), preserving the service order. */
async function collectGoalHistory(
  fetchPage: (cursor?: string) => Promise<GoalPage>,
): Promise<GoalRow[]> {
  const collected: GoalRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    collected.push(...page.goals);
    if (collected.length >= COLLECT_CEILING || !page.nextCursor) {
      return collected.slice(0, COLLECT_CEILING);
    }
    cursor = page.nextCursor;
  }
}

/**
 * The origin todo-service keys Focus's **read** grant to, and the self-service route
 * that writes it (`SPEC-todo-origin` assumption 12).
 *
 * The grant row belongs to todo-service, not to this app: the settings screen asks
 * todo-service for the permission, exactly as the meals switch does — the difference
 * is only that meals asks through meal-service's relay, while Focus has no relay
 * route and asks the owner's own `client_id` for it directly.
 */
export const FOCUS_ORIGIN_SERVICE = 'focus-service';

/**
 * todo-service's base URL — the same knob and default `lib/todo-api.ts` reads.
 *
 * Restated here because {@link grantFocusRead} and {@link readGrantState} are the
 * Focus ↔ todos seam, and this is the only file the Focus feature owns; the grant
 * cannot live in `todo-api.ts` without putting a Focus constant in the generic todo
 * client. Same variable, so one dev env points both at one service.
 */
const TODO_API_URL = process.env.TODO_API_URL ?? 'http://127.0.0.1:3005';

function todoCall<T>(path: string, init?: RequestInit): Promise<T> {
  return callService<T>(TODO_API_URL, path, init);
}

/** The grant row `POST /api/todos/origin-grant` answers with (the service's `OwnGrantView`). */
export interface OwnGrantView {
  ownerSub: string;
  clientId: string;
  originService: string;
  direction: string;
  grantedAt: string;
}

/**
 * `POST /api/todos/origin-grant` — allow Focus to read the owner's open tasks.
 *
 * The body names the origin and nothing else: the owner comes from the token's `sub`
 * and the grantee from its verified `client_id`, and todo-service takes the direction,
 * the read scope and the disclosure sentence from its own tables. There is no matching
 * DELETE anywhere in the service — a grant is a one-way permission — so this call has
 * no inverse and the screen says so rather than offering one.
 */
export function grantFocusRead(): Promise<OwnGrantView> {
  return todoCall<OwnGrantView>('/api/todos/origin-grant', {
    method: 'POST',
    body: JSON.stringify({ originService: FOCUS_ORIGIN_SERVICE }),
  });
}

/**
 * Whether the owner's client already holds Focus's read grant — read from the service,
 * never assumed.
 *
 * There is no `GET` for the grant itself, so the read that answers it is the one the
 * grant *opens*: `GET /api/todos/origin/open` answers 403 exactly when no read grant
 * exists (`TodosService.readGrant`), and any success means one does. That is a
 * capability probe rather than a row read, which is the honest thing to render from —
 * a grant the read cannot use is not a grant the screen should call granted.
 *
 * `'unknown'` is its own answer, not a folded-into-`'missing'` one: todo-service being
 * down is not the same fact as the owner never having allowed it, and a screen that
 * showed "Allow" after a failed check would invite a press that cannot land.
 *
 * `unstable_rethrow` comes first so a missing session still reaches its login redirect:
 * `requireSession` signals that by throwing, and swallowing it here would turn "log in"
 * into "task access is unknown".
 */
export type GrantState = 'granted' | 'missing' | 'unknown';

export async function readGrantState(): Promise<GrantState> {
  try {
    await todoCall<unknown>('/api/todos/origin/open');
    return 'granted';
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ApiError && error.status === 403) return 'missing';
    return 'unknown';
  }
}
