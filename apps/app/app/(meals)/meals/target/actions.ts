'use server';

import { revalidatePath } from 'next/cache';
import { putMealProfile } from '@/lib/meal-api';
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
  revalidatePath('/meals/target');
  revalidatePath('/meals');
}
