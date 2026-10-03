import 'server-only';
import type { NutrientVector } from '@life/nutrition';
import { callService } from './client';

const MEAL_API_URL = process.env.MEAL_API_URL ?? 'http://127.0.0.1:3106';

function call<T>(path: string, init?: RequestInit): Promise<T> {
  return callService<T>(MEAL_API_URL, path, init);
}

/** The meal a diary entry belongs to (`SPEC-meal-service` entries). */
export type MealGroup = 'breakfast' | 'lunch' | 'dinner' | 'snack';

/** The wire shape of one diary entry (`EntriesService.EntryDto`). */
export interface MealEntry {
  id: string;
  date: string;
  mealGroup: MealGroup;
  foodId: string;
  quantity: number;
  nutrients: NutrientVector;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** The wire shape of a target row (`TargetService.TargetDto`). */
export interface MealTarget {
  id: string;
  validFrom: string;
  age: number;
  sex: string;
  heightCm: number;
  weightKg: number;
  activity: string;
  goal: string;
  bmr: number;
  tdee: number;
  calories: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * `GET /api/entries?date=` — the owner's entries for one day. `date` is the
 * **client's** resolved `YYYY-MM-DD` (lesson 0019); the service never derives a
 * day from its own clock, so the BFF passes `getToday()`'s value through.
 */
export function listDayEntries(date: string): Promise<MealEntry[]> {
  return call<MealEntry[]>(`/api/entries?${new URLSearchParams({ date })}`);
}

/**
 * `GET /api/target?date=` — the target row applicable on `date` (same client
 * day). A missing profile is a 404; callers treat it as "no target yet".
 */
export function getMealTarget(date: string): Promise<MealTarget> {
  return call<MealTarget>(`/api/target?${new URLSearchParams({ date })}`);
}
