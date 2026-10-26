import type { FoodNutrition } from './food-form';
import { groupedFields } from '../nutrition-fields';

/**
 * The facts the food form renders, derived here as plain JSON: `@life/nutrition` is
 * server-side only (plan Task 14 — no `'use client'` component imports it), so the
 * labels and units cross the boundary as data. The groups themselves live in
 * `../nutrition-fields`, shared with the entry editor.
 */
export const FOOD_NUTRITION: FoodNutrition = { groups: groupedFields() };
