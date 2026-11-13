'use server';

import { revalidatePath } from 'next/cache';
import { putMealProfile } from '@/lib/meal-api';
import { kickPendingTodos } from '@/lib/outbox-relay';
import { getToday } from '@/lib/today';

/**
 * Persist the profile as a new versioned target row (`PUT /api/target/profile`,
 * `SPEC-target-onboarding`). The action owns the day: it resolves the caller's
 * `YYYY-MM-DD` from the shared `getToday()` owner (lesson 0019 — never a fresh
 * clock read in a request path) and sends ONLY the profile inputs the form
 * collected. The computed kcal/BMR/TDEE/macro grams are derived server-side and
 * are never part of this body (the service's `forbidNonWhitelisted` pipe rejects
 * them). On success both the target page and the day view are revalidated, so
 * the new target shows immediately.
 *
 * The save also owes the owner's OPEN tasks a new number — meal-service enqueues one
 * `todos.rename` per group inside the same write — and that queue is drained here, by
 * the BFF, because `origin_grant` is keyed to this app's client id and no service
 * holds a credential that could deliver it. Without this kick the intents sit pending
 * until the owner happens to log a meal, so a changed target left the tasks naming the
 * old one. Same best-effort contract as every other meal write: the save already
 * succeeded, and a delivery that cannot run yet must not fail it.
 */
export async function saveProfileAction(input: {
  age: number;
  sex: string;
  heightCm: number;
  weightKg: number;
  activity: string;
  goal: string;
}): Promise<void> {
  await putMealProfile({ ...input, date: await getToday() });
  kickPendingTodos();
  revalidatePath('/meals/target');
  revalidatePath('/meals');
}
