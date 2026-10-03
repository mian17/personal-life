'use server';

import { revalidatePath } from 'next/cache';
import { deleteSavedMeal } from '@/lib/meal-api';

// ponytail: the one-tap re-log moved up to the module's server-actions file
// (`../actions.ts`, plan Task 18) — this file stays only as the re-export the
// already-wired `saved/[id]` page imports, so nothing outside scope moves.
export { relogMealAction } from '../actions';

/** Delete one saved meal, then refresh the list it was shown on. */
export async function deleteSavedMealAction(id: string): Promise<void> {
  await deleteSavedMeal(id);
  revalidatePath('/meals/saved');
}
