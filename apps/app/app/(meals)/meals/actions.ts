'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createMealEntry, FOOD_ID_MAX, getSavedMeal } from '@/lib/meal-api';
import { getToday } from '@/lib/today';

/**
 * One-tap re-log for a saved meal (`docs/intent/meal-nutrition.md`: "re-logged
 * in one tap ... with the corrected numbers — not re-guessed").
 *
 * Reads the stored snapshot (`GET /api/saved-meals/:id`) and creates one diary
 * entry per frozen item (`POST /api/entries`) from the frozen numbers — it
 * never calls Gemini and never re-derives a nutrient. The day is the shared
 * `getToday()` owner's value (lesson 0019), never a fresh clock read, and the
 * caller lands on that day's route.
 *
 * This is the `meals` module's server-actions file (`SPEC-meal-capture-ui.md:43`,
 * plan Task 18): the saved-meals list's one-tap re-log lives here, not in the
 * `saved/` subtree.
 */
export async function relogMealAction(id: string): Promise<void> {
  const date = await getToday();
  const saved = await getSavedMeal(id);
  for (const item of saved.items) {
    await createMealEntry({
      date,
      mealGroup: saved.mealGroup,
      // An item saved without a catalog food keeps the meal's name as its id —
      // bounded like every other write, so a long name can't 400 the re-log.
      foodId: (item.foodId ?? saved.name).slice(0, FOOD_ID_MAX),
      quantity: item.quantity,
      nutrients: item.nutrients,
    });
  }
  revalidatePath('/meals');
  redirect(`/meals/${date}`);
}
