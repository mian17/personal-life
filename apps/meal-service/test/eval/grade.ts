/**
 * The offline grader for the meal-photo prompt eval (`SPEC-photo-identity.md`
 * § The tool loop). Pure: no network, no disk, no clock — it answers one
 * question, "did this model answer honour the prompt's contract?", from data
 * the caller already has.
 *
 * It grades **before** the service's `OfferedIds` gate (`photo.service.ts`):
 * a wrong id the gate rejects would otherwise look like "no data" and hide the
 * prompt failure this harness exists to see.
 *
 * The contract it checks, in the order the prompt states it: the right number
 * of items (a pot of three foods is three items), one item per distinct food
 * and no invented item, no dish or combination in any name, and every id bound
 * to the food's own search — its `searchQuery` was actually issued and that
 * query really offered its `fdcId`.
 */

import type { PhotoFoodSuggestion } from '../../src/photo/gemini.client.js';

/** How the answer's item count relates to the fixture's: the two failure directions. */
export type Granularity = 'exact' | 'merged' | 'split';

/** One food the fixture expects, matched by any of its acceptable names. */
export interface ExpectedFood {
  /** Lower-cased name fragments; an item matches when its name contains one. */
  any: string[];
  /** When true, the matched item must carry a bound `fdcId` from its own search. */
  requireId?: boolean;
}

/** The parsed `expected.json` of one fixture. */
export interface ExpectedMeal {
  id: string;
  scenario: string;
  photo: string;
  itemCount: number;
  foods: ExpectedFood[];
  forbiddenInName: string[];
  note?: string;
}

/** Everything the grader reads: the fixture, the model's answer, and the search the answer saw. */
export interface GradeInputs {
  expected: ExpectedMeal;
  items: PhotoFoodSuggestion[];
  /** Every query the stub search tool was asked this sample. */
  issuedQueries: string[];
  /** The `fdcId`s each query offered, so an id can be traced to its own search. */
  offeredIdsByQuery: Map<string, number[]>;
}

/** The grader's verdict: one flag, the reasons when it is down, and the item-level score. */
export interface GradeVerdict {
  pass: boolean;
  failures: string[];
  matchedFoods: number;
  granularity: Granularity;
}

/** Grade one sample's answer against its fixture. Pure. */
export function gradeRead({
  expected,
  items,
  issuedQueries,
  offeredIdsByQuery,
}: GradeInputs): GradeVerdict {
  const failures: string[] = [];
  const granularity = granularityOf(expected.itemCount, items.length);
  reportItemCount(expected.itemCount, items.length, granularity, failures);

  const matchedItemsByFood = matchFoodsToItems(expected.foods, items, failures);
  reportForbiddenInNames(items, expected.forbiddenInName, failures);
  reportUnboundIds(
    expected.foods,
    items,
    matchedItemsByFood,
    issuedQueries,
    offeredIdsByQuery,
    failures,
  );

  return {
    pass: failures.length === 0,
    failures,
    matchedFoods: matchedItemsByFood.filter((matched) => matched.length > 0).length,
    granularity,
  };
}

/** The direction of an item-count mismatch: fewer items merged foods, more split them. */
function granularityOf(expectedCount: number, actualCount: number): Granularity {
  if (actualCount === expectedCount) return 'exact';
  return actualCount < expectedCount ? 'merged' : 'split';
}

function reportItemCount(
  expectedCount: number,
  actualCount: number,
  granularity: Granularity,
  failures: string[],
): void {
  if (granularity === 'exact') return;
  failures.push(`item count: expected ${expectedCount}, got ${actualCount} (${granularity})`);
}

/**
 * Match each expected food to the model items whose name contains one of its
 * fragments, and report both mismatch directions. Returns, per expected food,
 * the model-item indices it matches. A one-to-one pairing is what the prompt
 * asks for: an expected food matching nothing is a miss, a model item matching
 * nothing is invented, and either matching several is ambiguous.
 */
function matchFoodsToItems(
  foods: ExpectedFood[],
  items: PhotoFoodSuggestion[],
  failures: string[],
): number[][] {
  const itemNames = items.map((item) => normalizeName(item.name));
  const matchedItemsByFood = foods.map((food) =>
    itemNames.flatMap((name, itemIndex) => (matchesFood(name, food) ? [itemIndex] : [])),
  );
  const matchedFoodsByItem = itemNames.map((name) =>
    foods.flatMap((food, foodIndex) => (matchesFood(name, food) ? [foodIndex] : [])),
  );

  matchedItemsByFood.forEach((matchedItems, foodIndex) => {
    if (matchedItems.length === 0)
      failures.push(`expected "${describeFood(foods[foodIndex])}" matched no item`);
    if (matchedItems.length > 1)
      failures.push(
        `expected "${describeFood(foods[foodIndex])}" matched ${matchedItems.length} items`,
      );
  });
  matchedFoodsByItem.forEach((matchedFoods, itemIndex) => {
    if (matchedFoods.length === 0)
      failures.push(`item "${items[itemIndex].name}" matches no expected food`);
    if (matchedFoods.length > 1)
      failures.push(
        `item "${items[itemIndex].name}" matches ${matchedFoods.length} expected foods`,
      );
  });

  return matchedItemsByFood;
}

/** True when the normalised item name contains one of the food's acceptable fragments. */
function matchesFood(normalizedName: string, food: ExpectedFood): boolean {
  return food.any.some((fragment) => normalizedName.includes(normalizeName(fragment)));
}

function reportForbiddenInNames(
  items: PhotoFoodSuggestion[],
  forbidden: string[],
  failures: string[],
): void {
  for (const item of items) {
    const normalizedName = normalizeName(item.name);
    for (const fragment of forbidden) {
      if (normalizedName.includes(fragment))
        failures.push(`name "${item.name}" contains forbidden "${fragment}"`);
    }
  }
}

/**
 * The id-binding check, on the fixture's matched items only: an expected food
 * that requires an id must be matched by exactly one item carrying an `fdcId`
 * that its own reported `searchQuery` really offered. An id no query offered,
 * or one another query's search offered, is not a bound id.
 */
function reportUnboundIds(
  foods: ExpectedFood[],
  items: PhotoFoodSuggestion[],
  matchedItemsByFood: number[][],
  issuedQueries: string[],
  offeredIdsByQuery: Map<string, number[]>,
  failures: string[],
): void {
  const issued = new Set(issuedQueries);
  matchedItemsByFood.forEach((matchedItems, foodIndex) => {
    if (foods[foodIndex].requireId !== true) return;
    if (matchedItems.length !== 1) return;
    reportBoundId(items[matchedItems[0]], issued, offeredIdsByQuery, failures);
  });
}

function reportBoundId(
  item: PhotoFoodSuggestion,
  issuedQueries: Set<string>,
  offeredIdsByQuery: Map<string, number[]>,
  failures: string[],
): void {
  if (item.fdcId === null) {
    failures.push(`"${item.name}" has no fdcId but the fixture requires one`);
    return;
  }
  if (item.searchQuery === null) {
    failures.push(`"${item.name}" has fdcId ${item.fdcId} but no searchQuery`);
    return;
  }
  if (!issuedQueries.has(item.searchQuery)) {
    failures.push(`"${item.name}" reports searchQuery "${item.searchQuery}" that was never issued`);
    return;
  }
  const offered = offeredIdsByQuery.get(item.searchQuery) ?? [];
  if (!offered.includes(item.fdcId)) {
    failures.push(
      `"${item.name}" fdcId ${item.fdcId} was not offered by its own searchQuery "${item.searchQuery}"`,
    );
  }
}

function describeFood(food: ExpectedFood): string {
  return food.any.join(' | ');
}

/** Lower-case, trim, collapse internal whitespace — the comparison the grader names in. */
function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * The unbiased pass@k estimator the runner reports with: `1 - C(n-c, k) / C(n, k)`
 * over `sampleCount = n` and `passCount = c` — the chance at least one of k
 * drawn samples passes, not "any of my k passed". Falls to zero only when fewer
 * than k samples exist, the one case where no k-subset can be drawn.
 */
export function passAtK(sampleCount: number, passCount: number, k: number): number {
  if (sampleCount < k) return 0;
  return 1 - combinations(sampleCount - passCount, k) / combinations(sampleCount, k);
}

/**
 * `n choose k`, exact for the small integers the estimator uses. The running
 * product stays a whole binomial coefficient at every step, so no factorial and
 * no floating-point factorial approximation is involved; `k > n` is zero, which
 * is what makes `passAtK` return one when fewer than k samples failed.
 */
export function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  const steps = Math.min(k, n - k);
  for (let step = 0; step < steps; step += 1) {
    result = (result * (n - step)) / (step + 1);
  }
  return Math.round(result);
}
