'use server';

import { revalidatePath } from 'next/cache';
import { deleteSavedMeal } from '@/lib/meal-api';

/** Delete one saved meal, then refresh the list it was shown on. */
export async function deleteSavedMealAction(id: string): Promise<void> {
  await deleteSavedMeal(id);
  revalidatePath('/meals/saved');
}
