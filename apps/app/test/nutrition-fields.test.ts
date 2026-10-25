import { NUTRIENT_LABELS, NUTRIENTS } from '@life/nutrition';
import { field, groupedFields, GROUPS, unitOf } from '@/app/(meals)/meals/nutrition-fields';

/**
 * The pre-extraction value table, copied verbatim from the two files this module
 * replaced (`foods/fields.ts` and `entry/[id]/page.tsx` had these identical groups).
 * It is the contract: the extraction must not reorder or re-label anything.
 */
const EXPECTED_GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Macros', keys: ['calories', 'fat', 'carbohydrates', 'protein'] },
  {
    title: 'Fat breakdown',
    keys: ['monounsaturatedFat', 'polyunsaturatedFat', 'saturatedFat', 'transFat'],
  },
  { title: 'Cholesterol & sodium', keys: ['cholesterol', 'sodium'] },
  { title: 'Carb breakdown', keys: ['fiber', 'sugar'] },
  {
    title: 'Vitamins',
    keys: [
      'vitaminA',
      'vitaminC',
      'thiaminB1',
      'riboflavinB2',
      'niacinB3',
      'folateB9',
      'vitaminB6',
      'vitaminB12',
    ],
  },
  {
    title: 'Minerals',
    keys: ['calcium', 'iron', 'magnesium', 'phosphorus', 'potassium', 'zinc'],
  },
  { title: 'Other', keys: ['caffeine'] },
];

describe('nutrition-fields', () => {
  it('keeps the exact group titles and key order', () => {
    expect(GROUPS.map(({ title, keys }) => ({ title, keys: [...keys] }))).toEqual(
      EXPECTED_GROUPS,
    );
  });

  it('covers all 27 nutrient keys exactly once', () => {
    const keys = GROUPS.flatMap((group) => group.keys);
    expect(keys).toHaveLength(27);
    expect(new Set(keys).size).toBe(27);
    expect([...keys].sort()).toEqual(NUTRIENTS.map(({ key }) => key).sort());
  });

  it('resolves every field with the package label and unit', () => {
    const fields = groupedFields().flatMap((group) => group.fields);
    expect(fields).toHaveLength(27);
    for (const entry of fields) {
      expect(entry.label).toBe(NUTRIENT_LABELS[entry.key]);
      expect(entry.unit).toBe(unitOf(entry.key));
    }
  });

  it('returns a field for a single key', () => {
    expect(field('calories')).toEqual({
      key: 'calories',
      label: NUTRIENT_LABELS.calories,
      unit: unitOf('calories'),
    });
  });

  it('keeps group order and field order inside each group', () => {
    const grouped = groupedFields();
    expect(grouped.map((group) => group.title)).toEqual(
      EXPECTED_GROUPS.map((group) => group.title),
    );
    expect(grouped.map((group) => group.fields.map((entry) => entry.key))).toEqual(
      EXPECTED_GROUPS.map((group) => group.keys),
    );
  });
});
