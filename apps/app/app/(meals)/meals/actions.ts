'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  createMealEntry,
  createMealFood,
  deleteMealFood,
  FOOD_ID_MAX,
  getSavedMeal,
  updateMealFood,
  type CreateMealFoodInput,
  type UpdateMealFoodInput,
} from '@/lib/meal-api';
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
  await Promise.all(
    saved.items.map((item) =>
      createMealEntry({
        date,
        mealGroup: saved.mealGroup,
        // An item saved without a catalog food keeps the meal's name as its id —
        // bounded like every other write, so a long name can't 400 the re-log.
        foodId: (item.foodId ?? saved.name).slice(0, FOOD_ID_MAX),
        quantity: item.quantity,
        nutrients: item.nutrients,
      }),
    ),
  );
  revalidatePath('/meals');
  redirect(`/meals/${date}`);
}

/**
 * Create one catalog food (`SPEC-food-catalog-ui` AC2): a single
 * `POST /api/foods` with the hand-typed per-100 vector at `servingGrams: 100`
 * and the typed measures. Nothing is model-filled — the facts came from the
 * form's `Input`s, and a measure's vector is derived at the service
 * (`SPEC-food-units`), never sent from here.
 */
export async function createFoodAction(input: CreateMealFoodInput): Promise<void> {
  await createMealFood(input);
  revalidatePath('/meals/foods');
}

/**
 * Rewrite the editable fields of one catalog food (`SPEC-food-catalog-ui`
 * AC4). `unit` is not among them: it was chosen once at creation and the
 * service's whitelist rejects a change, so this action can never send it.
 * Past entries are immutable snapshots and are untouched by this write.
 */
export async function updateFoodAction(id: string, input: UpdateMealFoodInput): Promise<void> {
  await updateMealFood(id, input);
  revalidatePath('/meals/foods');
}

/**
 * Soft-delete one catalog food (`SPEC-food-catalog-ui` AC5). The service marks
 * the row; the entries already logged from it keep their stored numbers, so
 * this action revalidates only the catalog — no entry row is read or written.
 */
export async function deleteFoodAction(id: string): Promise<void> {
  await deleteMealFood(id);
  revalidatePath('/meals/foods');
}
