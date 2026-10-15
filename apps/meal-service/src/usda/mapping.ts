import { NUTRIENTS, type Nutrient, type NutrientUnit, type NutrientVector } from '@life/nutrition';
import { completeVector, zeroVector } from '../foods/content';

/**
 * The pure join between USDA FoodData Central rows and our 27-key vocabulary
 * (`docs/specs/SPEC-usda-source.md` § "The mapping"). No HTTP, no DI — the
 * client hands over `foodNutrients[]` and this decides what it means.
 *
 * Three rules carry the whole mapping, and the table below is only the first:
 *
 * 1. **Match by nutrient number, verify by normalised unit.** A row is accepted
 *    only when its normalised `unitName` equals the unit our key declares.
 * 2. **Normalisation is spelling only.** No conversion factor exists anywhere in
 *    this file: every one of the 27 rows' units is a spelling variant of our own,
 *    so a row we cannot read by spelling is `unmapped`, never guessed.
 * 3. **A missing row is `0`, a missing food is `unmapped`.** All-zero would read
 *    as "verified none"; `unmapped` reads as "we found nothing" — a different
 *    claim, so it is a different result.
 */

/** A `foodNutrients[]` row of `GET /v1/food/{fdcId}` — the only shape we map. */
export interface UsdaNutrientRow {
  nutrient: { number: string; unitName: string };
  amount?: number;
}

/** The mapper's outcome: our complete vector, or the typed reason we have none. */
export type MappedNutrients =
  | { ok: true; vector: NutrientVector }
  | { ok: false; reason: 'unmapped' };

/** USDA nutrient number (string on the wire) → our key and unit, from the spec table. */
const NUTRIENT_BY_USDA_NUMBER: Record<string, { key: Nutrient; unit: NutrientUnit }> = {
  '208': { key: 'calories', unit: 'kcal' },
  '204': { key: 'fat', unit: 'g' },
  '645': { key: 'monounsaturatedFat', unit: 'g' },
  '646': { key: 'polyunsaturatedFat', unit: 'g' },
  '606': { key: 'saturatedFat', unit: 'g' },
  '605': { key: 'transFat', unit: 'g' },
  '601': { key: 'cholesterol', unit: 'mg' },
  '307': { key: 'sodium', unit: 'mg' },
  '205': { key: 'carbohydrates', unit: 'g' },
  '291': { key: 'fiber', unit: 'g' },
  '269': { key: 'sugar', unit: 'g' },
  '203': { key: 'protein', unit: 'g' },
  '320': { key: 'vitaminA', unit: 'mcg' },
  '401': { key: 'vitaminC', unit: 'mg' },
  '404': { key: 'thiaminB1', unit: 'mg' },
  '405': { key: 'riboflavinB2', unit: 'mg' },
  '406': { key: 'niacinB3', unit: 'mg' },
  '417': { key: 'folateB9', unit: 'mcg' },
  '415': { key: 'vitaminB6', unit: 'mg' },
  '418': { key: 'vitaminB12', unit: 'mcg' },
  '301': { key: 'calcium', unit: 'mg' },
  '303': { key: 'iron', unit: 'mg' },
  '304': { key: 'magnesium', unit: 'mg' },
  '305': { key: 'phosphorus', unit: 'mg' },
  '306': { key: 'potassium', unit: 'mg' },
  '309': { key: 'zinc', unit: 'mg' },
  '262': { key: 'caffeine', unit: 'mg' },
};

/**
 * Every USDA spelling of each of our units, lower-cased. The set is the whole
 * normalisation: an unknown spelling normalises to nothing and the row is
 * `unmapped`, which is why `IU` and `kJ` are absent — no factor could carry
 * them into `mcg`/`kcal` correctly, so they never map.
 */
const NORMALISED_UNIT_SPELLINGS = new Map<string, NutrientUnit>([
  ['g', 'g'],
  ['mg', 'mg'],
  ['mcg', 'mcg'],
  ['ug', 'mcg'],
  // U+00B5 MICRO SIGN (what USDA sends) and U+03BC GREEK SMALL LETTER MU.
  ['µg', 'mcg'],
  ['μg', 'mcg'],
  ['kcal', 'kcal'],
]);

/** A row's `unitName`, reduced to one of our units — or `null` when we cannot read it. */
function normaliseUnit(unitName: string): NutrientUnit | null {
  return NORMALISED_UNIT_SPELLINGS.get(unitName.toLowerCase()) ?? null;
}

/**
 * A row is a nutrient we can read only when it has a known number, a finite
 * amount, and a unit that normalises to the one that number's key declares.
 * Group rows (Proximates, Minerals, Amino acids — no `amount`) and mismatched
 * units (an `IU` vitamin A) both stop here, structurally, with no group list.
 */
function readMappedRow(row: UsdaNutrientRow): { key: Nutrient; amount: number } | null {
  const mapping = NUTRIENT_BY_USDA_NUMBER[row.nutrient.number];
  if (!mapping) return null;
  if (typeof row.amount !== 'number' || !Number.isFinite(row.amount)) return null;
  if (normaliseUnit(row.nutrient.unitName) !== mapping.unit) return null;
  return { key: mapping.key, amount: row.amount };
}

/** Every readable row's value on top of zeroes, so an absent row means `0`. */
function collectMappedAmounts(rows: readonly UsdaNutrientRow[]): Map<Nutrient, number> {
  const amounts = new Map<Nutrient, number>();
  for (const row of rows) {
    const read = readMappedRow(row);
    if (read) amounts.set(read.key, read.amount);
  }
  return amounts;
}

/**
 * Turn `foodNutrients[]` into our per-100 g vector, or say plainly that we
 * could not. Nothing maps → `unmapped`, never an all-zero vector: a zero vector
 * is this codebase's meaning of "no nutrient data", and a food USDA did not
 * describe is not the same claim as a food we read as zero.
 *
 * The completeness rule belongs to `content.ts` — every vector leaves here
 * through `completeVector` (lesson 0016, one owner per rule).
 */
export function mapUsdaNutrients(rows: readonly UsdaNutrientRow[]): MappedNutrients {
  const amounts = collectMappedAmounts(rows);
  if (amounts.size === 0) return { ok: false, reason: 'unmapped' };

  const vector = zeroVector();
  for (const { key } of NUTRIENTS) vector[key] = amounts.get(key) ?? 0;
  return { ok: true, vector: completeVector(vector) };
}
