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
 * Body of `PUT /api/target/profile` — exactly the profile INPUTS (`SPEC-target-
 * onboarding` Boundaries) plus the client's `validFrom` day. The computed
 * kcal/BMR/TDEE/macro grams are deliberately absent: the service derives them
 * from these inputs, and its `forbidNonWhitelisted` pipe rejects a body that
 * carries them ("the client CANNOT send computed kcal/bmr/tdee/macros").
 */
export interface MealProfileInput {
  age: number;
  sex: string;
  heightCm: number;
  weightKg: number;
  activity: string;
  goal: string;
  date: string;
}

/**
 * `PUT /api/target/profile` — store a new versioned target row for a profile
 * change; prior rows are untouched, so past days keep the target that applied
 * then (`SPEC-target-onboarding`). `date` is the client's own day, resolved by
 * the shared owner (`getToday()`), never a fresh clock read here.
 */
export function putMealProfile(input: MealProfileInput): Promise<MealTarget> {
  return call<MealTarget>('/api/target/profile', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

/**
 * The ONE photo estimate path (`SPEC-meal-service` Photo → Gemini pipeline).
 * It is a named constant so the literal exists in exactly one place: this BFF
 * client is the single call site, and the service route is the single definition.
 */
const PHOTO_ESTIMATE_PATH = '/api/estimates/photo';

/**
 * One resolved estimate item, exactly as the service reports it: the food's
 * name, the grams the estimate weighed, the catalog id when one matched, the
 * USDA id when the model read one, the food's own base serving, and that
 * base's nutrient vector. The BFF forwards every field; it computes none —
 * the grams → servings conversion happens in the editor, which is where the
 * user sees and corrects the weight.
 */
export interface PhotoEstimateItem {
  name: string;
  grams: number;
  foodId: string | null;
  fdcId: number | null;
  servingGrams: number;
  nutrients: NutrientVector;
}

/**
 * Every reason an estimate can fail with, over the wire. `no-image` is the BFF's
 * own (no file, or an empty one); `meal-service` sends the other two. The set is
 * a closed union, not `string`, so a fourth value would be a type error here
 * rather than a silently wrong banner (`SPEC-photo-identity.md § Failure reasons`).
 */
export type PhotoFailureReason = 'no-image' | 'could-not-read' | 'service-unavailable';

/**
 * The estimate's explicit result shape. `readable: false` carries no items on
 * purpose: a caller cannot render "0 kcal" from a failure, because there is
 * nothing to render but the reason.
 */
export type PhotoEstimate =
  | { readable: true; items: PhotoEstimateItem[] }
  | { readable: false; reason: PhotoFailureReason };

/** The image bytes, base64-encoded; they live only for the duration of the request. */
export interface PhotoImage {
  base64: string;
  mimeType: string;
}

/**
 * The photo estimate call: a suggestion, never an entry. `hint` is the
 * optional steering text (a hint, never a correction). A transport or non-2xx
 * failure throws; a `readable: false` body carries the reason the caller
 * renders — the photo's own (`could-not-read`) or the service's
 * (`service-unavailable`).
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

/**
 * `CreateEntryDto.FOOD_ID_MAX` on the service — the bound a write's `foodId`
 * must respect (lesson 0016: one owner for the value; the entry editor mirrors
 * it locally because it predates this export).
 */
export const FOOD_ID_MAX = 64;

export function createMealEntry(input: CreateMealEntryInput): Promise<MealEntry> {
  return call<MealEntry>('/api/entries', { method: 'POST', body: JSON.stringify(input) });
}

export function updateMealEntry(
  id: string,
  input: UpdateMealEntryInput,
): Promise<MealEntry> {
  return call<MealEntry>(`/api/entries/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

/** The canonical unit a food's amounts are in (`SPEC-food-units`); chosen once. */
export type FoodUnit = 'g' | 'ml';

/**
 * The food-write bounds declared by `CreateFoodDto` on the service. The app
 * mirrors the values here — it may not import `apps/meal-service`, and a second
 * respell would drift (lesson 0016: one owner for the value).
 */
export const FOOD_NAME_MAX = 120;
export const SERVING_LABEL_MAX = 60;
export const PORTIONS_MAX = 20;
export const AMOUNT_MAX = 5000;

/** The wire shape of one serving (`FoodsService.ServingDto`). */
export interface ServingDto {
  id: string;
  label: string;
  amount: number;
  nutrients: NutrientVector;
}

/**
 * One measure a write sends: its label and its amount in the food's own unit.
 * The vector is never client input — the service derives it with `scale()`
 * (`SPEC-food-units`).
 */
export interface ServingInput {
  label: string;
  amount: number;
}

/** The wire shape of one catalog food (`FoodsService.FoodDto`). */
export interface MealFood {
  id: string;
  name: string;
  unit: FoodUnit;
  servingGrams: number;
  nutrients: NutrientVector;
  servings: ServingDto[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * `GET /api/foods?q=` — the owner's active (non-deleted) catalog, or the foods
 * whose decrypted name matches `q`. The service filters after the cache hit, so
 * the search never enters the cache key (`SPEC-meal-service` Cache Rules); the
 * names arrive decrypted, so the log path can compare them in memory.
 */
export function listMealFoods(q?: string): Promise<MealFood[]> {
  return call<MealFood[]>(`/api/foods${q ? `?${new URLSearchParams({ q })}` : ''}`);
}

/**
 * `GET /api/foods?includeDeleted=1` — the owner's whole catalog, soft-deleted
 * rows included (same DTO, same owner scoping). Only past-entry name resolution
 * reads this: a deleted food still names the entries and saved-meal items that
 * logged it (`SPEC-food-catalog-ui` AC5). Pickers and lists keep the active read.
 */
export function listMealFoodsIncludingDeleted(): Promise<MealFood[]> {
  return call<MealFood[]>('/api/foods?includeDeleted=1');
}

/** `GET /api/foods/:id` — one catalog food by id (owner-scoped; a foreign id is a 404). */
export function getMealFood(id: string): Promise<MealFood> {
  return call<MealFood>(`/api/foods/${id}`);
}

/** Body of `POST /api/foods` — the base facts plus the measures the food starts with. */
export interface CreateMealFoodInput {
  name: string;
  unit?: FoodUnit;
  servingGrams: number;
  nutrients: NutrientVector;
  portions?: ServingInput[];
}

/**
 * `POST /api/foods` — create the catalog food one logged item is missing.
 * `servingGrams` is 100 and `nutrients` is the confirmed vector un-scaled back
 * to that base (`SPEC-meal-capture-grams § The log-time create path`); an
 * omitted `unit` is the service's `'g'`.
 */
export function createMealFood(input: CreateMealFoodInput): Promise<MealFood> {
  return call<MealFood>('/api/foods', { method: 'POST', body: JSON.stringify(input) });
}

/**
 * Body of `PATCH /api/foods/:id`. `unit` is deliberately absent: the unit is
 * chosen once and the service's whitelist rejects a change (`SPEC-food-units`).
 */
export interface UpdateMealFoodInput {
  name?: string;
  nutrients?: NutrientVector;
  portions?: ServingInput[];
  expectedVersion?: number;
}

/** `PATCH /api/foods/:id` — rewrite the fields a body carries; omitted ones stay. */
export function updateMealFood(id: string, input: UpdateMealFoodInput): Promise<MealFood> {
  return call<MealFood>(`/api/foods/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

/** `DELETE /api/foods/:id` — soft delete (owner-scoped; a foreign id is a 404). */
export function deleteMealFood(id: string): Promise<void> {
  return call<void>(`/api/foods/${id}`, { method: 'DELETE' });
}

/**
 * The dish name a restored entry or saved-meal item shows. `foodId` carries a
 * resolved catalog id from this feature on, so the name comes from the catalog —
 * which callers read **including soft-deleted rows**, because a deleted food
 * still names what it was logged as (`SPEC-food-catalog-ui` AC5). An id
 * matching no row — active or deleted — is a pre-feature entry whose `foodId`
 * *is* the dish name, so that stored value is the name; an unmatched id is
 * never rendered as a label. (`SPEC-meal-capture-grams` keeps `MealEntry`
 * name-free and the service unedited, so the join happens on the page, from
 * this list.)
 */
export function restoredFoodName(foodId: string, catalog: MealFood[]): string {
  return catalog.find((food) => food.id === foodId)?.name ?? foodId;
}

export function createSavedMeal(input: CreateSavedMealInput): Promise<SavedMeal> {
  return call<SavedMeal>('/api/saved-meals', { method: 'POST', body: JSON.stringify(input) });
}

/** `GET /api/saved-meals` — the owner's frozen meals, newest-first. */
export function listSavedMeals(): Promise<SavedMeal[]> {
  return call<SavedMeal[]>('/api/saved-meals');
}

/** `GET /api/saved-meals/:id` — one frozen meal by id (a foreign id is a 404). */
export function getSavedMeal(id: string): Promise<SavedMeal> {
  return call<SavedMeal>(`/api/saved-meals/${id}`);
}

/** `DELETE /api/saved-meals/:id` — soft delete (owner-scoped; a foreign id is a 404). */
export function deleteSavedMeal(id: string): Promise<void> {
  return call<void>(`/api/saved-meals/${id}`, { method: 'DELETE' });
}
