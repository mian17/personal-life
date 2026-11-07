/**
 * The `meal` service module (SPEC-ops-all-services §1.3): four resources mirroring
 * `apps/meal-service` route for route — `entries` five, `foods` five, `saved-meals`
 * four, `target` one, fifteen in all. Both adapters render this registry, so the
 * meal route shape lives here alone.
 *
 * Every table is declared through `defineResource`, like the four sibling modules, so
 * the registry this file exports is the one frozen, default-filled shape the adapters
 * read (SPEC-ops-all-services §5). Core Question 6.4 (whether a module-declared nested
 * `properties` map survives normalisation) is answered by `normalizeField` rebuilding
 * nested `properties` recursively: the tables below reach the adapters intact, and
 * validation, the MCP `inputSchema`, and the wire body all derive from them.
 *
 * The 27 nutrient keys are spelled out here instead of imported, in `NUTRIENTS` order
 * (`packages/nutrition/src/nutrients.ts:55-91`): the package imports nothing from
 * `@life/nutrition`, so `meal-parity.test.ts` is what holds the two tables together.
 */
import { defineResource } from '../core/registry';
import type { FieldSpec, ResourceRegistry } from '../core/types';

/** The meal groups an entry or a saved meal belongs to, as `MEAL_GROUPS` spells them. */
const MEAL_GROUPS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

/** The one unit a food is measured in, chosen at creation and immutable after. */
const FOOD_UNITS = ['g', 'ml'] as const;

/**
 * The 27 keys a nutrient vector carries, in `NUTRIENTS` order
 * (`packages/nutrition/src/nutrients.ts:55-91`). Order is part of the contract: the
 * table below is written in it, and the parity suite compares the two lists.
 */
const NUTRIENT_KEYS = [
  'calories',
  'fat',
  'monounsaturatedFat',
  'polyunsaturatedFat',
  'saturatedFat',
  'transFat',
  'cholesterol',
  'sodium',
  'carbohydrates',
  'fiber',
  'sugar',
  'protein',
  'vitaminA',
  'vitaminC',
  'thiaminB1',
  'riboflavinB2',
  'niacinB3',
  'folateB9',
  'vitaminB6',
  'vitaminB12',
  'calcium',
  'iron',
  'magnesium',
  'phosphorus',
  'potassium',
  'zinc',
  'caffeine',
] as const;

export const resources: ResourceRegistry[] = [
  defineResource({
    name: 'entries',
    basePath: '/api/entries',
    ops: [
      {
        kind: 'create',
        fields: {
          date: {
            type: 'string',
            required: true,
            description: 'Client-local day the entry belongs to, `YYYY-MM-DD`',
          },
          mealGroup: {
            type: 'string',
            required: true,
            enum: MEAL_GROUPS,
            description: 'Meal the entry is logged in',
          },
          foodId: {
            type: 'string',
            required: true,
            description: 'Identifier of the catalogued food logged',
          },
          quantity: {
            type: 'number',
            required: true,
            description: 'Amount logged, in the food unit',
          },
          nutrients: requiredVector(),
        },
      },
      {
        kind: 'list',
        fields: {
          date: {
            type: 'string',
            required: true,
            description: 'Client-local day to list, `YYYY-MM-DD`; the service never defaults it',
          },
          meal: {
            type: 'string',
            enum: MEAL_GROUPS,
            description: 'Only entries logged in this meal group',
          },
          ...pageWindow('entries'),
        },
      },
      { kind: 'get', fields: { id: identifier('entry to read') } },
      {
        kind: 'update',
        fields: {
          id: identifier('entry to correct'),
          date: {
            type: 'string',
            description: 'Day to file the entry under, `YYYY-MM-DD`',
          },
          mealGroup: {
            type: 'string',
            enum: MEAL_GROUPS,
            description: 'Meal to file the entry under',
          },
          quantity: {
            type: 'number',
            description: 'Corrected amount, in the food unit',
          },
          nutrients: nutrientVector(),
          expectedVersion: versionSeen(),
        },
      },
      { kind: 'delete', fields: { id: identifier('entry to remove') } },
    ],
  }),
  defineResource({
    name: 'foods',
    basePath: '/api/foods',
    ops: [
      {
        kind: 'create',
        fields: {
          name: {
            type: 'string',
            required: true,
            description: 'Food name, at most 120 characters',
          },
          unit: {
            type: 'string',
            enum: FOOD_UNITS,
            description: 'Unit every amount of this food is measured in; omitted means `g`',
          },
          servingGrams: {
            type: 'number',
            required: true,
            description: 'Grams one serving of this food weighs, 1 to 5000',
          },
          portions: portionList(),
          nutrients: nutrientVector(),
        },
      },
      {
        kind: 'list',
        fields: {
          q: { type: 'string', description: 'Only foods whose name matches this search' },
          includeDeleted: {
            type: 'boolean',
            description: 'Whether foods removed from the catalog appear too',
          },
          ...pageWindow('foods'),
        },
      },
      { kind: 'get', fields: { id: identifier('food to read') } },
      {
        kind: 'update',
        fields: {
          id: identifier('food to correct'),
          name: { type: 'string', description: 'Corrected food name' },
          servingGrams: {
            type: 'number',
            description: 'Corrected serving weight in grams',
          },
          portions: portionList(),
          nutrients: nutrientVector(),
          expectedVersion: versionSeen(),
        },
      },
      { kind: 'delete', fields: { id: identifier('food to remove from the catalog') } },
    ],
  }),
  defineResource({
    name: 'saved-meals',
    basePath: '/api/saved-meals',
    ops: [
      {
        kind: 'create',
        fields: {
          name: {
            type: 'string',
            required: true,
            description: 'Saved meal name, at most 120 characters',
          },
          mealGroup: {
            type: 'string',
            required: true,
            enum: MEAL_GROUPS,
            description: 'Meal group the saved meal logs into',
          },
          items: requiredItemList(),
        },
      },
      { kind: 'list', fields: pageWindow('saved meals') },
      { kind: 'get', fields: { id: identifier('saved meal to read') } },
      { kind: 'delete', fields: { id: identifier('saved meal to remove') } },
    ],
  }),
  defineResource({
    name: 'target',
    basePath: '/api/target',
    ops: [
      {
        kind: 'list',
        fields: {
          date: {
            type: 'string',
            required: true,
            description: 'Day the target applies to, `YYYY-MM-DD`; the service never defaults it',
          },
        },
      },
    ],
  }),
];

/**
 * One page of a meal listing: how many rows, and where the page starts. The
 * descriptions copy `pageWindow()` in `./todo.ts` because `@life/ops` imports
 * no service constant — `meal-parity.test.ts` pins the wording, so a drifted
 * number fails parity rather than production (`SPEC-pagination-seam` §5).
 */
function pageWindow(entity: string): Record<string, FieldSpec> {
  return {
    limit: { type: 'number', description: `Page size, 1 to 200 ${entity}` },
    cursor: {
      type: 'string',
      description: 'Opaque cursor the previous page returned; passed back untouched',
    },
  };
}

/** A nutrient vector the caller must send: the amounts already confirmed for this snapshot. */
function requiredVector(): FieldSpec {
  return { ...nutrientVector(), required: true };
}

/**
 * One nutrient vector: the 27 amounts a food, entry, or saved-meal item carries.
 * All 27 keys are required inside it, because the service stores no partial vector
 * (`completeVector()` in `apps/meal-service/src/foods/content.ts`); whether the vector
 * itself may be omitted is the caller's choice per op, stated by `requiredVector()`.
 */
function nutrientVector(): FieldSpec {
  return {
    type: 'object',
    properties: nutrientProperties(),
    description: 'Nutrient amounts: all 27 keys, or no vector at all',
  };
}

/** One descriptor per nutrient key, in `NUTRIENT_KEYS` order. */
function nutrientProperties(): Record<string, FieldSpec> {
  return Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, nutrientAmount(key)]));
}

/** One nutrient's amount, in that nutrient's own unit; a complete vector carries all 27. */
function nutrientAmount(key: string): FieldSpec {
  return { type: 'number', required: true, description: `Amount of ${key}, in its own unit` };
}

/** The pickable measures of one food: each an amount in the food's own unit. */
function portionList(): FieldSpec {
  return {
    type: 'object[]',
    properties: {
      label: {
        type: 'string',
        required: true,
        description: 'What the measure is called, e.g. `1 carton`',
      },
      amount: {
        type: 'number',
        required: true,
        description: "Amount of the measure, in the food's unit",
      },
    },
    description: 'Measures one serving of this food can be logged in',
  };
}

/** The foods a saved meal must freeze, each with the vector confirmed when it was saved. */
function requiredItemList(): FieldSpec {
  return { ...itemList(), required: true };
}

/** One frozen item of a saved meal: what was logged, and its nutrient snapshot. */
function itemList(): FieldSpec {
  return {
    type: 'object[]',
    properties: {
      foodId: {
        type: 'string',
        description: 'Catalogued food this item came from; absent for an uncatalogued dish',
      },
      quantity: {
        type: 'number',
        required: true,
        description: 'Amount logged, in the food unit',
      },
      nutrients: requiredVector(),
    },
    description: 'Frozen foods the saved meal logs back, nutrient snapshots included',
  };
}

/** The field naming one row; `role` says what the caller does with it. */
function identifier(role: string): FieldSpec {
  return { type: 'string', required: true, description: `Identifier of the ${role}` };
}

/** The concurrency token an update carries, so a stale write fails with `409`. */
function versionSeen(): FieldSpec {
  return {
    type: 'number',
    description: 'Version the caller last saw; a stale value fails with 409',
  };
}
