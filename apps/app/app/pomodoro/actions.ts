'use server';

import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { setPrefNumbers } from '@life/app-kit/preference-action';
import { clampMinutes, isDailyGoal } from '@life/pomodoro';
import { answerFocusQuestion, grantFocusRead, recordSession, setGoal } from '@/lib/focus-api';
import { updateTodo } from '@/lib/todo-api';
import { getToday } from '@/lib/today';

/** The three form fields and the cookie each one persists. */
const DURATION_FIELDS = [
  { field: 'focus', pref: 'pomodoro_focus' },
  { field: 'short', pref: 'pomodoro_short' },
  { field: 'long', pref: 'pomodoro_long' },
] as const;

/** Where a refused daily goal sends the owner back: this app's settings form, flagged. */
const GOAL_REJECTED_HREF = '/pomodoro/settings?goal=rejected';

/**
 * Persist the three duration preferences, so a reload starts the timer from the
 * minutes the owner edited (SPEC-pomodoro §4, State storage).
 */
export async function setPomodoroDurations(formData: FormData): Promise<void> {
  // One batch write, not one round trip per field: the three cookies are
  // independent, so awaiting inside the loop only cost two extra cookie-store
  // reads and two extra revalidations.
  await setPrefNumbers(
    DURATION_FIELDS.map(
      ({ field, pref }) => [pref, clampMinutes(Number(formData.get(field)))] as const,
    ),
  );
}

/**
 * Set the focus length without touching the two breaks, so a quick-pick chip persists the
 * same `pomodoro_focus` the settings form writes (SPEC-pomodoro §4, State storage). The
 * cookie write revalidates the app, so the `/pomodoro` subtitle is rendered from it too.
 */
export async function setPomodoroFocusMinutes(minutes: number): Promise<void> {
  await setPrefNumbers([['pomodoro_focus', clampMinutes(minutes)]]);
}

/** The break a boundary chip was pressed for, and the cookie that length lives in. */
const BREAK_PREFS = {
  short: 'pomodoro_short',
  long: 'pomodoro_long',
} as const;

/**
 * Set one break length without touching the focus length or the other break, so a chip at a
 * boundary persists the same cookie the settings form writes. `clampMinutes` holds a
 * mistyped value to the one-block default, exactly as the focus chip does.
 */
export async function setPomodoroBreakMinutes(
  phase: 'short' | 'long',
  minutes: number,
): Promise<void> {
  await setPrefNumbers([[BREAK_PREFS[phase], clampMinutes(minutes)]]);
}

/**
 * Set today's goal (`PUT /api/goal`). The day is the shared `getToday()` owner,
 * so only today re-measures: a past day keeps the goal its own dated row gave it
 * (`SPEC-focus-service` §1).
 *
 * A daily goal is a day's total focus, so a mistyped one is refused and the owner is sent
 * back to the form — never replaced by a number they did not choose (`clampMinutes` would
 * put one block's 25 minutes in its place).
 */
export async function setPomodoroGoal(formData: FormData): Promise<void> {
  const minutes = Number(formData.get('goal'));

  if (!isDailyGoal(minutes)) redirect(GOAL_REJECTED_HREF);
  else await setGoal(await getToday(), minutes);
}

/**
 * Keep one finished focus block in the owner's day (`POST /api/sessions`). The
 * day is resolved here by the shared `getToday()` owner, never by the browser
 * clock (lesson 0019), and a part-minute block is a block the day does not hold.
 *
 * `todoId` rides the same write when the owner picked a task. The service refuses an
 * id the caller's read grant does not reach, so a stale pick fails the record rather
 * than storing a reference nothing can resolve — which is why the answer is the
 * stored row's id: the client cannot invent one.
 */
export async function recordFocusSession(
  minutes: number,
  todoId?: string,
): Promise<{ id: string } | null> {
  if (minutes < 1) return null;

  const row = await recordSession(await getToday(), minutes, todoId);
  return { id: row.id };
}

/** The two answers the "done?" question accepts. Both are answers; only one ticks. */
export type FocusAnswer = 'done' | 'not-yet';

/**
 * Answer the question a recorded block's task raised, and tick the task when the answer
 * is `Done`.
 *
 * The tick is the **owner's own** `PATCH /api/todos/:id`, made with the owner's token:
 * the owner is the actor, so this is an ordinary edit and needs no write grant. Focus
 * never writes a todo, and the producer origin-tick route is not involved (that one is
 * for a service acting as itself).
 *
 * The answer is written either way, so the question is asked once — `Not yet` writes
 * nothing further, and both answers stop it returning.
 */
export async function answerFocusQuestionAction(
  sessionId: string,
  todoId: string,
  answer: FocusAnswer,
): Promise<void> {
  if (answer === 'done') await updateTodo(todoId, { done: true });
  await answerFocusQuestion(sessionId);
  revalidatePath('/pomodoro');
}

/**
 * Allow Focus to read the owner's open tasks — the settings screen's one-way action.
 *
 * A grant is not revocable: todo-service has no DELETE for it, so there is no "off"
 * call here to offer, and the screen states that instead of drawing a switch that
 * would move back and change nothing. The grantee is the caller's own verified
 * `client_id` (todo-service takes it from the token), so pressing this cannot hand
 * the permission to anyone else.
 *
 * Both screens are revalidated because the grant changes what each one can say:
 * `/pomodoro` gains its task picker, `/pomodoro/settings` stops offering Allow.
 */
export async function grantFocusReadAction(): Promise<GrantResult> {
  try {
    await grantFocusRead();
    revalidatePath('/pomodoro');
    revalidatePath('/pomodoro/settings');
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: "Couldn't allow task access. Try again." };
  }
}

/** What the settings row needs back: whether the grant landed, and why not when it did not. */
export type GrantResult = { ok: true } | { ok: false; message: string };
