/**
 * Offline unit tests for the prompt grader (`grade.ts`). No network, no
 * `GeminiClient`, no disk: every case builds its own expected meal and its own
 * items, so no test inherits state from another.
 */

import type { PhotoFoodSuggestion } from '../../src/photo/gemini.client.js';
import { combinations, gradeRead, passAtK, type ExpectedMeal } from './grade.js';

/** A fresh three-food fixture: chicken, tofu, yardlong beans, each needing a bound id. */
function threeFoodMeal(): ExpectedMeal {
  return {
    id: 'test-meal',
    scenario: 'three separable foods',
    photo: 'photo.jpg',
    itemCount: 3,
    foods: [
      { any: ['chicken'], requireId: true },
      { any: ['tofu', 'bean curd'], requireId: true },
      { any: ['yardlong bean', 'long bean', 'snake bean', 'asparagus bean'], requireId: true },
    ],
    forbiddenInName: [' and ', 'soup', ' with '],
  };
}

function suggestion(
  name: string,
  fdcId: number | null,
  searchQuery: string | null,
): PhotoFoodSuggestion {
  return { name, grams: 100, foodId: null, fdcId, searchQuery };
}

/** The search the three-food fixture's items should have run: each query offered its own id. */
function threeFoodSearch(): { issuedQueries: string[]; offeredIdsByQuery: Map<string, number[]> } {
  return {
    issuedQueries: ['chicken', 'tofu', 'yardlong beans'],
    offeredIdsByQuery: new Map([
      ['chicken', [11]],
      ['tofu', [22]],
      ['yardlong beans', [33]],
    ]),
  };
}

function threeBoundItems(): PhotoFoodSuggestion[] {
  return [
    suggestion('chicken', 11, 'chicken'),
    suggestion('tofu', 22, 'tofu'),
    suggestion('yardlong beans', 33, 'yardlong beans'),
  ];
}

describe('gradeRead', () => {
  it('passes an exact, fully bound answer', () => {
    const verdict = gradeRead({
      expected: threeFoodMeal(),
      items: threeBoundItems(),
      ...threeFoodSearch(),
    });

    expect(verdict.pass).toBe(true);
    expect(verdict.failures).toEqual([]);
    expect(verdict.matchedFoods).toBe(3);
    expect(verdict.granularity).toBe('exact');
  });

  it('reports a merged answer when two items stand in for three foods', () => {
    const verdict = gradeRead({
      expected: threeFoodMeal(),
      items: [suggestion('chicken', 11, 'chicken'), suggestion('tofu', 22, 'tofu')],
      ...threeFoodSearch(),
    });

    expect(verdict.pass).toBe(false);
    expect(verdict.granularity).toBe('merged');
    expect(verdict.failures).toContain('item count: expected 3, got 2 (merged)');
  });

  it('reports a split answer when one food becomes four items', () => {
    const verdict = gradeRead({
      expected: threeFoodMeal(),
      items: [
        suggestion('chicken breast', 11, 'chicken'),
        suggestion('chicken thigh', 11, 'chicken'),
        suggestion('tofu', 22, 'tofu'),
        suggestion('yardlong beans', 33, 'yardlong beans'),
      ],
      ...threeFoodSearch(),
    });

    expect(verdict.pass).toBe(false);
    expect(verdict.granularity).toBe('split');
    expect(verdict.failures).toContain('item count: expected 3, got 4 (split)');
  });

  it('rejects a dish name that contains a forbidden substring', () => {
    const verdict = gradeRead({
      expected: threeFoodMeal(),
      items: [
        suggestion('Chicken and Tofu Soup with Yardlong Beans', 11, 'chicken'),
        suggestion('tofu', 22, 'tofu'),
        suggestion('yardlong beans', 33, 'yardlong beans'),
      ],
      ...threeFoodSearch(),
    });

    expect(verdict.pass).toBe(false);
    expect(verdict.failures.some((failure) => failure.includes('contains forbidden'))).toBe(true);
  });

  it('rejects an item carrying an fdcId but no searchQuery', () => {
    const verdict = gradeRead({
      expected: threeFoodMeal(),
      items: [
        suggestion('chicken', 11, null),
        suggestion('tofu', 22, 'tofu'),
        suggestion('yardlong beans', 33, 'yardlong beans'),
      ],
      ...threeFoodSearch(),
    });

    expect(verdict.pass).toBe(false);
    expect(verdict.failures).toContain('"chicken" has fdcId 11 but no searchQuery');
  });

  it('rejects a searchQuery that was never issued to the tool', () => {
    const verdict = gradeRead({
      expected: threeFoodMeal(),
      items: [
        suggestion('chicken', 11, 'chiken'),
        suggestion('tofu', 22, 'tofu'),
        suggestion('yardlong beans', 33, 'yardlong beans'),
      ],
      ...threeFoodSearch(),
    });

    expect(verdict.pass).toBe(false);
    expect(verdict.failures).toContain(
      '"chicken" reports searchQuery "chiken" that was never issued',
    );
  });

  it('rejects an fdcId its own searchQuery did not offer', () => {
    const verdict = gradeRead({
      expected: threeFoodMeal(),
      items: [
        suggestion('chicken', 999, 'chicken'),
        suggestion('tofu', 22, 'tofu'),
        suggestion('yardlong beans', 33, 'yardlong beans'),
      ],
      ...threeFoodSearch(),
    });

    expect(verdict.pass).toBe(false);
    expect(verdict.failures).toContain(
      '"chicken" fdcId 999 was not offered by its own searchQuery "chicken"',
    );
  });
});

describe('pass@k', () => {
  it('counts combinations exactly, including the degenerate ranges', () => {
    expect(combinations(5, 0)).toBe(1);
    expect(combinations(5, 5)).toBe(1);
    expect(combinations(5, 2)).toBe(10);
    expect(combinations(5, 6)).toBe(0);
    expect(combinations(0, 0)).toBe(1);
  });

  it('is the unbiased estimator, not "any of k"', () => {
    expect(passAtK(5, 1, 1)).toBeCloseTo(0.2);
    expect(passAtK(20, 0, 1)).toBe(0);
  });

  it('is one when fewer than k samples failed, and zero when fewer than k exist', () => {
    expect(passAtK(20, 20, 5)).toBe(1);
    expect(passAtK(5, 5, 5)).toBe(1);
    expect(passAtK(4, 2, 5)).toBe(0);
  });
});
