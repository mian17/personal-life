'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { getToday } from '@/lib/today';
import { setMealTodos } from '@/lib/meal-api';

/** What the switch needs back: whether it stayed moved, and why not when it did not. */
export type MealTodoResult = { ok: true } | { ok: false; message: string };

/**
 * The switch's write seam (`SPEC-todo-origin` assumption 12).
 *
 * `getToday()` is read here rather than in the service because the day belongs to
 * the client (lesson 0019): the service is told which day to create the tasks for.
 * Both `/meals/settings` and `/todos` are revalidated on success — the switch lives
 * on the first and its effect is three new tasks on the second, so leaving either
 * cached would show the user a screen that disagrees with what just happened.
 *
 * A failure is one message for the row to render, the failure contract
 * `submitFeedbackAction` sets; `unstable_rethrow` keeps Next's own control-flow
 * errors (redirect, notFound) from being swallowed as a user-facing message.
 */
export async function setMealTodosAction(enabled: boolean): Promise<MealTodoResult> {
  try {
    await setMealTodos(enabled, await getToday());
    revalidatePath('/meals/settings');
    revalidatePath('/todos');
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    return {
      ok: false,
      message:
        enabled === true
          ? "Couldn't turn on meal tasks. Try again."
          : "Couldn't turn off meal tasks. Try again.",
    };
  }
}
