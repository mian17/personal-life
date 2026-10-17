'use client';

import { useState } from 'react';
import {
  Button,
  ButtonLink,
  EmptyState,
  List,
  ListItem,
  SearchField,
  Section,
} from '@life/ui';
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
 * The manual-log door's food search: type a name, tap a row's `Log`, and the
 * pick is handed to the editor — then the query stays put so the next food can
 * be logged immediately (multi-add is the point). The candidates arrive from
 * the server page already decrypted, so the match is an in-memory substring —
 * the service's own `q` filter would cost a round trip per keystroke.
 *
 * Nothing is listed while the query is empty: a catalog can hold 100+ foods,
 * and dumping it would bury the field.
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
  const searching = query.trim() !== '';

  return (
    <Section label="Log food">
      <SearchField
        label="Search foods"
        placeholder="Search your foods"
        value={query}
        onQueryChange={setQuery}
      />
      {searching &&
        (shown.length === 0 ? (
          <EmptyState body={`No food name contains “${query.trim()}”.`} />
        ) : (
          <List>
            {shown.map(({ food, per100Calories }) => (
              <ListItem
                key={food.id}
                title={food.name}
                meta={per100Calories}
                trailing={
                  <Button
                    size="bare"
                    aria-label={`Log ${food.name}`}
                    onClick={() => onPick(food, DEFAULT_UNIT_AMOUNT / food.servingGrams)}
                  >
                    Log
                  </Button>
                }
              />
            ))}
          </List>
        ))}
    </Section>
  );
}

function matches(name: string, query: string): boolean {
  return name.toLowerCase().includes(query.trim().toLowerCase());
}
