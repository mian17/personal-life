'use client';

import { useState } from 'react';
import {
  Button,
  ButtonLink,
  EmptyState,
  Input,
  List,
  ListItem,
  Pill,
  PillGroup,
  SearchField,
  Section,
  SettingsRow,
  StatusText,
} from '@life/ui';
import type { MealFood, ServingDto } from '@/lib/meal-api';

/**
 * The manual-log door's amount (`SPEC-manual-log-ui` AC2): either a value in
 * the food's own unit, or one of its named measures counted `count` times.
 * There is exactly one stored quantity and no unit conversion anywhere.
 */
export type LoggedAmount =
  | { kind: 'unit'; value: number }
  | { kind: 'measure'; count: number; measure: ServingDto };

/** One catalog row the picker can offer, with the per-100 facts the page formatted server-side. */
export interface PickerFood {
  food: MealFood;
  per100Calories: string;
}

type OnPick = (food: MealFood, quantity: number) => void;

/**
 * The quantity the editor stores for `food` (`SPEC-manual-log-ui § 4`):
 * `(measure ? count × measure.amount : value) / food.servingGrams`. For a
 * per-100 ml food, 250 ml is 2.5 and one 1000 ml measure is 10.
 */
export function loggedQuantity(food: MealFood, amount: LoggedAmount): number {
  const inUnit = amount.kind === 'measure' ? amount.count * amount.measure.amount : amount.value;
  return inUnit / food.servingGrams;
}

/**
 * Step one of the manual-log door: pick a catalog food, then its amount. The
 * candidates arrive from the server page already decrypted, and the search
 * narrows them in memory — one catalog is small, and the service's own `q`
 * filter would cost a round trip per keystroke. Confirming hands the editor the
 * food and its quantity; the snapshot and review-before-save stay the editor's.
 */
export function FoodPicker({ foods, onPick }: { foods: PickerFood[]; onPick: OnPick }) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<MealFood | null>(null);

  if (foods.length === 0) return <EmptyCatalog />;
  if (chosen === null) {
    return (
      <FoodChoices foods={foods} query={query} onQueryChange={setQuery} onChoose={setChosen} />
    );
  }
  return <AmountStep key={chosen.id} food={chosen} onPick={onPick} />;
}

function FoodChoices({
  foods,
  query,
  onQueryChange,
  onChoose,
}: {
  foods: PickerFood[];
  query: string;
  onQueryChange: (q: string) => void;
  onChoose: (food: MealFood) => void;
}) {
  const shown = foods.filter(({ food }) => matches(food.name, query));

  return (
    <Section label="Log food">
      <SearchField
        label="Search foods"
        placeholder="Search your foods"
        value={query}
        onQueryChange={onQueryChange}
      />
      {shown.length === 0 ? (
        <EmptyState body={`No food name contains “${query.trim()}”.`} />
      ) : (
        <List>
          {shown.map(({ food, per100Calories }) => (
            <ListItem
              key={food.id}
              title={food.name}
              meta={per100Calories}
              trailing={
                <Button size="bare" aria-label={`Log ${food.name}`} onClick={() => onChoose(food)}>
                  Log
                </Button>
              }
            />
          ))}
        </List>
      )}
    </Section>
  );
}

function AmountStep({ food, onPick }: { food: MealFood; onPick: OnPick }) {
  const [unitText, setUnitText] = useState('100');
  const [measureId, setMeasureId] = useState<string | null>(null);
  const [countText, setCountText] = useState('1');

  const measure = food.servings.find(({ id }) => id === measureId) ?? null;
  const amount = measure === null ? unitAmount(unitText) : countedAmount(countText, measure);

  function toggleMeasure(next: ServingDto) {
    setMeasureId((current) => (current === next.id ? null : next.id));
  }

  function confirm() {
    if (amount === null) return;
    onPick(food, loggedQuantity(food, amount));
  }

  return (
    <Section label={`Log ${food.name}`}>
      {food.servings.length > 0 && (
        <PillGroup label="Named measures">
          {food.servings.map((serving) => (
            <Pill
              key={serving.id}
              as="button"
              size="chip"
              active={measureId === serving.id}
              aria-pressed={measureId === serving.id}
              onClick={() => toggleMeasure(serving)}
            >
              {serving.label}
            </Pill>
          ))}
        </PillGroup>
      )}
      {measure === null ? (
        <SettingsRow
          label="Amount"
          control={
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              aria-label={`Amount in ${food.unit}`}
              value={unitText}
              onChange={(event) => setUnitText(event.target.value)}
            />
          }
        />
      ) : (
        <SettingsRow
          label={`How many ${measure.label}`}
          control={
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              aria-label={`Number of ${measure.label}`}
              value={countText}
              onChange={(event) => setCountText(event.target.value)}
            />
          }
        />
      )}
      <StatusText>
        {measure === null
          ? `in ${food.unit}`
          : `each ${measure.label} is ${measure.amount} ${food.unit}`}
      </StatusText>
      <Button disabled={amount === null} onClick={confirm}>
        Log food
      </Button>
    </Section>
  );
}

function EmptyCatalog() {
  return (
    <Section label="Log food">
      <EmptyState body="No foods in your catalog yet. Add one, then log it here in a few taps." />
      <ButtonLink href="/meals/foods">Add a food</ButtonLink>
    </Section>
  );
}

/** A positive, finite number typed into a box — `null` for blank, junk, or non-positive. */
function parseAmount(raw: string): number | null {
  const value = Number(raw);
  return raw.trim() !== '' && Number.isFinite(value) && value > 0 ? value : null;
}

function unitAmount(raw: string): LoggedAmount | null {
  const value = parseAmount(raw);
  return value === null ? null : { kind: 'unit', value };
}

function countedAmount(raw: string, measure: ServingDto): LoggedAmount | null {
  const count = parseAmount(raw);
  return count === null ? null : { kind: 'measure', count, measure };
}

function matches(name: string, query: string): boolean {
  return name.toLowerCase().includes(query.trim().toLowerCase());
}
