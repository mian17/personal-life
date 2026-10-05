import { NUTRIENTS } from '@life/nutrition';
import { mapUsdaNutrients, type UsdaNutrientRow } from '../src/usda/mapping';

/**
 * `docs/specs/SPEC-usda-source.md` § "The mapping" — the pure join. Fixtures
 * copy the nested `GET /v1/food/{fdcId}` shape from the live sample
 * (`/tmp/opencode/usda-food.json`, broccoli fdcId 170379): a row reads its
 * number from `nutrient.number` (a string), its unit from `nutrient.unitName`,
 * and its value from the row's top-level `amount` — nothing else.
 */

/** A fetch-by-id nutrient row in the wire's spelling, amount optional on purpose. */
function usdaRow(number: string, unitName: string, amount?: number): UsdaNutrientRow {
  return { nutrient: { number, unitName }, amount };
}

/** The four contested rows of the spec's table, as USDA actually spells them. */
const ENERGY_KCAL = usdaRow('208', 'kcal', 34);
const ENERGY_KJ = usdaRow('268', 'kJ', 141);
const STARCH = usdaRow('209', 'g', 0);
const TOTAL_SUGARS = usdaRow('269', 'g', 1.7);
const FOLATE_TOTAL = usdaRow('417', 'µg', 63);
const FOLATE_DFE = usdaRow('435', 'µg', 63);
const VITAMIN_A_RAE = usdaRow('320', 'µg', 31);
const VITAMIN_A_IU = usdaRow('318', 'IU', 623);

/** Every nutrient row of a mapped food, at its mapped value or `0` when absent. */
function expectCompleteVector(result: ReturnType<typeof mapUsdaNutrients>) {
  if (!result.ok) throw new Error('expected a mapped vector');
  for (const { key } of NUTRIENTS) {
    expect(result.vector[key]).toEqual(expect.any(Number));
  }
  return result.vector;
}

describe('mapUsdaNutrients — the four contested rows', () => {
  it('maps calories from 208 Energy (KCAL), ignoring 268 Energy (kJ) and 209 Starch', () => {
    const vector = expectCompleteVector(mapUsdaNutrients([ENERGY_KCAL, ENERGY_KJ, STARCH]));

    expect(vector.calories).toBe(34);
    // 268's kJ and 209's starch both survive as *unmapped*: only 208 ever feeds calories.
    expect(vector.carbohydrates).toBe(0);
  });

  it('maps sugar from 269 Total Sugars, whose nutrientId 2000 is not a number', () => {
    const vector = expectCompleteVector(mapUsdaNutrients([TOTAL_SUGARS]));

    expect(vector.sugar).toBe(1.7);
  });

  it('maps folateB9 from 417 Folate, total — never 435 Folate, DFE', () => {
    const vector = expectCompleteVector(mapUsdaNutrients([FOLATE_TOTAL, FOLATE_DFE]));

    expect(vector.folateB9).toBe(63);
    // One row in, one value out: a DFE row can never double-count into the total.
    expect(vector.folateB9).not.toBe(126);
  });

  it('maps vitaminA from 320 RAE (µg), and an IU row cannot stand in for it', () => {
    const vector = expectCompleteVector(mapUsdaNutrients([VITAMIN_A_RAE, VITAMIN_A_IU]));

    expect(vector.vitaminA).toBe(31);
    // IU→RAE is form-dependent, so the 318 row must not have moved the number.
    expect(vector.vitaminA).not.toBe(623);
  });
});

describe('mapUsdaNutrients — units are read, never converted', () => {
  it('accepts both endpoints’ spellings of the same unit', () => {
    const fetchById = expectCompleteVector(
      mapUsdaNutrients([
        usdaRow('204', 'g', 0.37),
        usdaRow('307', 'mg', 33),
        usdaRow('417', 'µg', 63),
        usdaRow('208', 'kcal', 34),
      ]),
    );
    expect(fetchById.fat).toBe(0.37);
    expect(fetchById.sodium).toBe(33);
    expect(fetchById.folateB9).toBe(63);
    expect(fetchById.calories).toBe(34);

    const searchSpellings = expectCompleteVector(
      mapUsdaNutrients([
        usdaRow('204', 'G', 0.37),
        usdaRow('307', 'MG', 33),
        usdaRow('417', 'UG', 63),
        usdaRow('208', 'KCAL', 34),
      ]),
    );
    expect(searchSpellings).toEqual(fetchById);
  });

  it('yields unmapped when the unit is not a spelling of the key’s unit', () => {
    // Energy arrives in kJ only: nothing we may call calories without a factor.
    expect(mapUsdaNutrients([usdaRow('208', 'kJ', 34)])).toEqual({ ok: false, reason: 'unmapped' });
    // Vitamin A in IU only: no factor carries IU into mcg correctly.
    expect(mapUsdaNutrients([VITAMIN_A_IU])).toEqual({ ok: false, reason: 'unmapped' });
  });

  it('never reads a mismatched row for another nutrient by accident', () => {
    // Saturated fat misreported in mg: unmapped overall — the one readable row
    // is nothing, and a silent pass-through would have invented 0.114 mg of fat.
    expect(mapUsdaNutrients([usdaRow('606', 'mg', 0.114)])).toEqual({
      ok: false,
      reason: 'unmapped',
    });
  });
});

describe('mapUsdaNutrients — the payload’s own structure decides', () => {
  it('skips a row because it carries no amount, never because of its number', () => {
    const proximates = usdaRow('951', 'g'); // Proximates: a group header, no amount.
    const minerals = usdaRow('300', 'mg'); // Minerals: same shape, different number.
    const caloriesWithoutAmount = usdaRow('208', 'kcal'); // Mapped number, no amount.

    expect(mapUsdaNutrients([proximates, minerals])).toEqual({ ok: false, reason: 'unmapped' });
    expect(mapUsdaNutrients([proximates, caloriesWithoutAmount])).toEqual({
      ok: false,
      reason: 'unmapped',
    });

    const vector = expectCompleteVector(mapUsdaNutrients([ENERGY_KCAL, caloriesWithoutAmount]));
    expect(vector.calories).toBe(34);
  });

  it('yields unmapped when nothing in the payload maps', () => {
    expect(mapUsdaNutrients([])).toEqual({ ok: false, reason: 'unmapped' });
    expect(mapUsdaNutrients([STARCH, ENERGY_KJ, usdaRow('312', 'mg', 0.049)])).toEqual({
      ok: false,
      reason: 'unmapped',
    });
  });

  it('fills every missing row as 0 and still returns a complete vector', () => {
    const vector = expectCompleteVector(mapUsdaNutrients([ENERGY_KCAL]));

    expect(vector.calories).toBe(34);
    expect(Object.keys(vector)).toHaveLength(NUTRIENTS.length);
    for (const { key } of NUTRIENTS) {
      if (key !== 'calories') expect(vector[key]).toBe(0);
    }
  });

  it('reads the live broccoli payload into our 27-key vector', () => {
    const broccoli: UsdaNutrientRow[] = [
      usdaRow('951', 'g'), // Proximates — group header.
      usdaRow('255', 'g', 89.3), // Water: not ours.
      ENERGY_KCAL,
      ENERGY_KJ,
      usdaRow('203', 'g', 2.82),
      usdaRow('204', 'g', 0.37),
      usdaRow('956', 'g'), // Carbohydrates — group header.
      usdaRow('205', 'g', 6.64),
      usdaRow('291', 'g', 2.6),
      usdaRow('269', 'g', 1.7),
      STARCH,
      usdaRow('300', 'mg'), // Minerals — group header.
      usdaRow('301', 'mg', 47),
      usdaRow('303', 'mg', 0.73),
      usdaRow('304', 'mg', 21),
      usdaRow('305', 'mg', 66),
      usdaRow('306', 'mg', 316),
      usdaRow('307', 'mg', 33),
      usdaRow('309', 'mg', 0.41),
      usdaRow('952', 'g'), // Vitamins and Other Components — group header.
      usdaRow('401', 'mg', 89.2),
      usdaRow('404', 'mg', 0.071),
      usdaRow('405', 'mg', 0.117),
      usdaRow('406', 'mg', 0.639),
      usdaRow('415', 'mg', 0.175),
      FOLATE_TOTAL,
      FOLATE_DFE,
      usdaRow('418', 'µg', 0),
      VITAMIN_A_RAE,
      VITAMIN_A_IU,
      usdaRow('950', 'g'), // Lipids — group header.
      usdaRow('606', 'g', 0.114),
      usdaRow('645', 'g', 0.031),
      usdaRow('646', 'g', 0.112),
      usdaRow('605', 'g', 0),
      usdaRow('601', 'mg', 0),
      usdaRow('500', 'g'), // Amino acids — group header.
      usdaRow('262', 'mg', 0),
    ];

    const vector = expectCompleteVector(mapUsdaNutrients(broccoli));

    expect(vector).toEqual({
      calories: 34,
      fat: 0.37,
      monounsaturatedFat: 0.031,
      polyunsaturatedFat: 0.112,
      saturatedFat: 0.114,
      transFat: 0,
      cholesterol: 0,
      sodium: 33,
      carbohydrates: 6.64,
      fiber: 2.6,
      sugar: 1.7,
      protein: 2.82,
      vitaminA: 31,
      vitaminC: 89.2,
      thiaminB1: 0.071,
      riboflavinB2: 0.117,
      niacinB3: 0.639,
      folateB9: 63,
      vitaminB6: 0.175,
      vitaminB12: 0,
      calcium: 47,
      iron: 0.73,
      magnesium: 21,
      phosphorus: 66,
      potassium: 316,
      zinc: 0.41,
      caffeine: 0,
    });
  });
});
