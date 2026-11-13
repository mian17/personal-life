import 'server-only';
import { ApiError } from './api-error';
import { callService } from './client';
import {
  listPendingMealIntents,
  markMealIntents,
  type MealIntentOutcome,
  type PendingMealIntent,
} from './meal-api';
import { completeTodoByOrigin, createTodoWithOrigin, type TodoOriginCreateBody } from './todo-api';

/**
 * The delivery leg of the meal → todo outbox, and the reason it lives in the BFF.
 *
 * A meal intent is not sendable by any service: `origin_grant` in todo-service is
 * keyed `(ownerSub, clientId)`, the grant is written for the client the user's own
 * token names (`app`, the BFF), and `clientCredentials` is disabled in the IdP. So
 * the only caller that can act on the grant is this one, holding the user's session.
 * meal-service therefore exposes its queue (`GET /api/meal-todo/pending`) and a
 * report route (`POST /api/meal-todo/published`), and this module drains it.
 *
 * Three rules hold for every delivery:
 * - one bad row never aborts the batch — each attempt is isolated and reported;
 * - the outcome is recorded in **one** call per batch, successes and failures
 *   together, so a stuck row carries the reason it stuck (`lastError`);
 * - nothing here throws into the caller. The meal was logged; the tick is
 *   best-effort, and a page must never fail because a todo could not be ticked.
 */

/** The destinations this relay knows how to send. */
const TODOS_CREATE = 'todos.create';
const TODOS_COMPLETE = 'todos.complete';
const TODOS_RENAME = 'todos.rename';

/**
 * The todo-service origin, spelled exactly as `lib/todo-api.ts` spells it.
 *
 * It is repeated here rather than imported because that module exports no base and
 * its one helper for this route does not exist yet; a relay that could only reach
 * the rename by widening `todo-api` would be a bigger change than the destination
 * it needs. ponytail: one duplicated base; move the send into `lib/todo-api.ts`
 * beside the create/tick helpers when that file is next open.
 */
const TODO_API_URL = process.env.TODO_API_URL ?? 'http://127.0.0.1:3005';

/**
 * The reason recorded when todo-service answers `403`: the user revoked the grant or
 * was never given one, so this row is terminal and must stop occupying the queue.
 * Publishing it with this reason is the revocation semantics the roadmap left as a
 * project decision — the alternative (retrying forever) would keep a dead intent in
 * front of every live one.
 */
const REVOKED_REASON = 'rejected by todos: 403 (revoked or never granted)';

/** What one drain did: rows closed, and rows still owed. */
export interface DrainResult {
  delivered: number;
  failed: number;
}

/**
 * The create body, read out of the payload the producer serialized. Only the two
 * fields that must be present are validated; the rest is forwarded verbatim, so a
 * field the producer adds later reaches todo-service without a change here.
 */
type CreatePayload = Partial<TodoOriginCreateBody> & Record<string, unknown>;

/** The fields a tick needs, read out of its payload. */
interface TickPayload {
  title?: string;
  occurrence?: string;
  originId?: string;
}

/** The fields a rename needs: the task it names and the title it should carry. */
interface RenamePayload {
  title?: string;
  originId?: string;
}

/**
 * Drain this session's pending meal intents: send each to todo-service with the
 * user's own token, then report the whole batch's outcomes in one call.
 *
 * Never throws. A read failure is a `{ delivered: 0, failed: 0 }` and a log line —
 * the caller is a page action that already succeeded, and delivery is not its
 * concern.
 */
export async function deliverPendingTodos(): Promise<DrainResult> {
  const intents = await readPending();
  if (intents.length === 0) return { delivered: 0, failed: 0 };

  const outcomes: MealIntentOutcome[] = [];
  for (const intent of intents) {
    outcomes.push(await attempt(intent));
  }
  await report(outcomes);

  return {
    delivered: outcomes.filter((outcome) => outcome.published).length,
    failed: outcomes.filter((outcome) => !outcome.published).length,
  };
}

/**
 * Fire-and-forget the drain from a page action that has already saved the user's meal.
 *
 * The write that matters is done; delivery is best-effort, so the page does not wait on
 * it. `next/server`'s `after()` is not used anywhere in this repo, so this is a bare
 * unawaited call with a catch: a rejection must never surface as an unhandled one in
 * the request that logged the meal.
 */
export function kickPendingTodos(): void {
  void deliverPendingTodos().catch((error: unknown) => warn('drain failed', error));
}

/** The pending read, or an empty queue when it fails. */
async function readPending(): Promise<PendingMealIntent[]> {
  try {
    const { intents } = await listPendingMealIntents();
    return Array.isArray(intents) ? intents : [];
  } catch (error) {
    warn('read failed', error);
    return [];
  }
}

/**
 * One intent's attempt, as the outcome to report.
 *
 * `409` is success, for two different reasons that are both "the row is already in
 * the state this intent wanted": a create is idempotent by origin id, and a rename
 * refuses a **done** task — the owner finished it, so the task is a record of what
 * they did and must not be rewritten. Publishing either one is the honest outcome;
 * retrying it would spin forever. `403` publishes with the revocation reason
 * (terminal). Anything else leaves the row pending with its reason, so the next
 * drain retries it.
 */
async function attempt(intent: PendingMealIntent): Promise<MealIntentOutcome> {
  try {
    await send(intent);
    return { id: intent.id, published: true };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return { id: intent.id, published: true };
    }
    if (error instanceof ApiError && error.status === 403) {
      return { id: intent.id, published: true, lastError: REVOKED_REASON };
    }
    return { id: intent.id, published: false, lastError: reasonOf(error) };
  }
}

/**
 * Send one intent to todo-service. An unknown destination, or a payload that cannot
 * name what it means, is a skip with a logged reason rather than a guess: sending a
 * tick at the wrong task would log the wrong day.
 */
async function send(intent: PendingMealIntent): Promise<void> {
  switch (intent.destination) {
    case TODOS_CREATE:
      return sendCreate(intent.payload);
    case TODOS_COMPLETE:
      return sendTick(intent.payload);
    case TODOS_RENAME:
      return sendRename(intent.payload);
    default:
      throw new Error(`unknown destination: ${intent.destination}`);
  }
}

/** `POST /api/todos/origin` with the producer's body, unreshaped. */
async function sendCreate(raw: string): Promise<void> {
  const payload = parse<CreatePayload>(raw);
  if (typeof payload.title !== 'string' || typeof payload.originId !== 'string') {
    throw new Error('create intent is missing title or originId');
  }
  await createTodoWithOrigin(payload as TodoOriginCreateBody);
}

/**
 * `POST /api/todos/origin/:originId/complete`, pinned to the payload's occurrence and
 * carrying its title. A row written before ticks carried `originId` has no task to
 * name, so it is skipped with a logged reason — never guessed at.
 */
async function sendTick(raw: string): Promise<void> {
  const payload = parse<TickPayload>(raw);
  if (!payload.originId) {
    throw new Error('tick intent carries no originId: skipped');
  }
  await completeTodoByOrigin(payload.originId, {
    ...(payload.title === undefined ? {} : { title: payload.title }),
    ...(payload.occurrence === undefined ? {} : { occurrence: payload.occurrence }),
  });
}

/**
 * `POST /api/todos/origin/:originId/rename`, carrying the payload's title.
 *
 * A rename names a title or it is not one, so a payload without it is a skip with a
 * logged reason rather than a request that would do nothing.
 */
async function sendRename(raw: string): Promise<void> {
  const payload = parse<RenamePayload>(raw);
  if (!payload.originId) {
    throw new Error('rename intent carries no originId: skipped');
  }
  if (typeof payload.title !== 'string') {
    throw new Error('rename intent is missing title');
  }
  await callService(
    TODO_API_URL,
    `/api/todos/origin/${encodeURIComponent(payload.originId)}/rename`,
    { method: 'POST', body: JSON.stringify({ title: payload.title }) },
  );
}

/** The report write, one call per batch. A failure here is logged, never thrown. */
async function report(outcomes: MealIntentOutcome[]): Promise<void> {
  try {
    await markMealIntents(outcomes);
  } catch (error) {
    // The sends happened but the bookkeeping did not: the rows stay pending, so the
    // next drain re-sends them. At-least-once, which is this pattern's promise.
    warn('outcome report failed', error);
  }
}

function parse<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error('intent payload is not JSON');
  }
}

/** One capped line, never a stack — the same rule the outbox's own column follows. */
function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').trim().slice(0, 200);
}

function warn(what: string, error: unknown): void {
  console.warn(`meal outbox relay: ${what}: ${reasonOf(error)}`);
}
