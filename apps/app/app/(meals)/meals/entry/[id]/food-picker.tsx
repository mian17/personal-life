'use client';

import { useState } from 'react';
import { Autosuggest, ButtonLink, EmptyState, Section, type AutosuggestOption } from '@life/ui';
import type { MealFood } from '@/lib/meal-api';

/** One catalog row the picker can offer, with the per-100 facts the page formatted server-side. */
export interface PickerFood {
  food: MealFood;
  per100Calories: string;
}

type OnPick = (food: MealFood, quantity: number) => void;

/** The default amount (`SPEC-manual-log-ui § 4`): 100 in the food's own unit over its base weight — one serving for the canonical 100 g food. */
const DEFAULT_UNIT_AMOUNT = 100;

/**
 * The manual-log door's food search: type a name, tap a row, and the pick is
 * handed to the editor — then the query stays put so the next food can be
 * logged immediately (multi-add is the point). The candidates arrive from the
 * server page already decrypted, so the match is an in-memory substring — the
 * service's own `q` filter would cost a round trip per keystroke.
 *
 * The combobox semantics (field text, the `minChars` gate, the popup, the
 * keyboard list) belong to the `Autosuggest` block; this file owns only the
 * filtering and the row → food meaning. Nothing is listed while the query is
 * empty: a catalog can hold 100+ foods, and dumping it would bury the field.
 */
export function FoodSearch({ foods, onPick }: { foods: PickerFood[]; onPick: OnPick }) {
  const [query, setQuery] = useState('');

  if (foods.length === 0) {
    return (
      <Section label="Log food">
        <EmptyState body="No foods in your catalog yet. Add one, then log it here in a few taps." />
        <ButtonLink href="/meals/foods">Add a food</ButtonLink>
      </Section>
    );
  }

  const shown = foods.filter(({ food }) => matches(food.name, query));

  /** The rows as the block's own vocabulary: the food's id is its React key and lookup handle, its name the label, the per-100 facts the quiet meta. */
  const options: AutosuggestOption[] = shown.map(({ food, per100Calories }) => ({
    id: food.id,
    label: food.name,
    meta: per100Calories,
  }));

  /** A row tap logs the food at the default amount — the block reports the row, this file knows it is a catalog row. */
  function select(option: AutosuggestOption) {
    const hit = foods.find(({ food }) => food.id === option.id);
    if (hit) onPick(hit.food, DEFAULT_UNIT_AMOUNT / hit.food.servingGrams);
  }

  return (
    <Section label="Log food">
      <Autosuggest
        label="Search foods"
        placeholder="Search your foods"
        options={options}
        emptyLabel={`No food name contains “${query}”.`}
        clearOnSelect={false}
        minChars={3}
        onQueryChange={setQuery}
        onSelect={select}
      />
    </Section>
  );
}

function matches(name: string, query: string): boolean {
  return query !== '' && name.toLowerCase().includes(query.toLowerCase());
}
