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

/** `GET /api/entries/:id` — one entry by id (owner-scoped; a foreign id is a 404). */
export function getMealEntry(id: string): Promise<MealEntry> {
  return call<MealEntry>(`/api/entries/${id}`);
}

/**
 * `GET /api/target?date=` — the target row applicable on `date` (same client
 * day). A missing profile is a 404; callers treat it as "no target yet".
 */
export function getMealTarget(date: string): Promise<MealTarget> {
  return call<MealTarget>(`/api/target?${new URLSearchParams({ date })}`);
}

/**
 * The ONE photo estimate path (`SPEC-meal-service` Photo → Gemini pipeline).
 * It is a named constant so the literal exists in exactly one place: this BFF
 * client is the single call site, and the service route is the single definition.
 */
const PHOTO_ESTIMATE_PATH = '/api/estimates/photo';

/** One dish the model read out of a photo (`GeminiClient.PhotoItemSuggestion`). */
export interface PhotoItemSuggestion {
  dish: string;
  ingredients: string[];
  portionGrams: number;
  nutrients: NutrientVector;
}

/**
 * The estimate's explicit result shape. `readable: false` carries no items on
 * purpose: a caller cannot render "0 kcal" from a failure, because there is
 * nothing to render but the reason.
 */
export type PhotoEstimate =
  | { readable: true; items: PhotoItemSuggestion[] }
  | { readable: false; reason: string };

/** The image bytes, base64-encoded; they live only for the duration of the request. */
export interface PhotoImage {
  base64: string;
  mimeType: string;
}

/**
 * The photo estimate call: a suggestion, never an entry. `hint` is the
 * optional steering text (a hint, never a correction). A transport or non-2xx
 * failure throws; the caller's only failure answer is "could not read".
 */
export function estimatePhoto(image: PhotoImage, hint?: string): Promise<PhotoEstimate> {
  return call<PhotoEstimate>(PHOTO_ESTIMATE_PATH, {
    method: 'POST',
    body: JSON.stringify({ imageBase64: image.base64, mimeType: image.mimeType, hint }),
  });
}

/** Body of `POST /api/entries` — one confirmed snapshot for one day. */
export interface CreateMealEntryInput {
  date: string;
  mealGroup: MealGroup;
  foodId: string;
  quantity: number;
  nutrients: NutrientVector;
}

/** Body of `PATCH /api/entries/:id` — the corrected values are what persist. */
export interface UpdateMealEntryInput {
  quantity?: number;
  nutrients?: NutrientVector;
  expectedVersion?: number;
}

/** One frozen saved-meal item (`CreateSavedMealDto.SavedMealItemInputDto`). */
export interface SavedMealItemInput {
  foodId?: string;
  quantity: number;
  nutrients: NutrientVector;
}

/** Body of `POST /api/saved-meals` — the corrected snapshot, frozen. */
export interface CreateSavedMealInput {
  name: string;
  mealGroup: MealGroup;
  items: SavedMealItemInput[];
}

/** The wire shape of a saved meal (`SavedMealsService.SavedMealDto`). */
export interface SavedMeal {
  id: string;
  name: string;
  mealGroup: MealGroup;
  items: Array<{ id: string; foodId: string | null; quantity: number; nutrients: NutrientVector }>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function createMealEntry(input: CreateMealEntryInput): Promise<MealEntry> {
  return call<MealEntry>('/api/entries', { method: 'POST', body: JSON.stringify(input) });
}

export function updateMealEntry(
  id: string,
  input: UpdateMealEntryInput,
): Promise<MealEntry> {
  return call<MealEntry>(`/api/entries/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function createSavedMeal(input: CreateSavedMealInput): Promise<SavedMeal> {
  return call<SavedMeal>('/api/saved-meals', { method: 'POST', body: JSON.stringify(input) });
}
