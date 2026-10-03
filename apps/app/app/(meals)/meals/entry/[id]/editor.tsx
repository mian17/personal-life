'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Check, Trash2 } from 'lucide-react';
import type { Nutrient, NutrientVector } from '@life/nutrition';
import {
  AlertBanner,
  Button,
  EditorChrome,
  EmptyState,
  FilePicker,
  IconButton,
  Input,
  List,
  ListItem,
  Section,
  Select,
  StatusText,
  Textarea,
} from '@life/ui';
import type { MealEntry, MealGroup } from '@/lib/meal-api';
import { estimatePhotoAction, saveAsMealAction, saveEntryAction } from './actions';

/**
 * The review-correct editor (`SPEC-meal-capture-ui`): the photo door's
 * suggestion becomes the starting item values, the user corrects portions and
 * values, then saves. The day's number is the sum of what was confirmed here.
 *
 * Composition is `@life/ui` only (Contract 1 Rule 1): the picker is `FilePicker`,
 * fields are `Input`/`Textarea`/`Select`, rows are `List`/`ListItem`, actions are
 * `Button`/`IconButton`. No raw element, no app-local CSS, no inline style.
 *
 * Nutrient display data (field labels, the unknown em dash, the all-zero
 * vector, the total's unit) arrives as plain-JSON props derived server-side
 * from `@life/nutrition` — the package stays out of the browser bundle (plan
 * Task 14: no `'use client'` component imports it). An estimated-but-unknown
 * field renders the em dash and never a fabricated `0`; `0` is only ever a
 * value the user actually confirmed.
 */

/**
 * The nutrition display data the server page derives from `@life/nutrition`.
 * Plain JSON, so it crosses the server/client boundary without the package.
 */
export interface NutritionFields {
  /** The fields the review step shows and corrects, in display order (one display choice, not a unit table). */
  fields: readonly { key: Nutrient; label: string }[];
  /** The unknown affordance: an estimated-but-unknown value renders this, never `0`. */
  unknown: string;
  /** The all-zero vector: the stored meaning of "no value", never a displayed number. */
  empty: NutrientVector;
  /** The unit the run total renders in (the calories unit on the server). */
  totalUnit: string;
}

/** The meal groups, in display order (`SPEC-meal-service` entries vocabulary). */
const GROUPS: { value: MealGroup; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snacks' },
];

/** `CreateEntryDto.FOOD_ID_MAX` on the service; the dish name stands in until a food picker exists. */
const FOOD_ID_MAX = 64;

/**
 * One reviewed item. `nutrients` is the **effective** vector (already scaled by
 * `quantity`) — the exact value that persists, so a correction and its saved
 * snapshot can never disagree.
 */
export interface EditorItem {
  dish: string;
  quantity: number;
  nutrients: NutrientVector;
  /** Fields the user has confirmed; everything else renders the unknown em dash. */
  known: readonly Nutrient[];
}

/**
 * The run total's display string — the server's formatter rule (whole number +
 * space + unit for a known value; the unknown em dash for a non-finite/negative
 * one), reproduced here from props so the client carries no `@life/nutrition`.
 */
function totalDisplay(value: number, unit: string, unknown: string): string {
  if (!Number.isFinite(value) || value < 0) return unknown;
  return `${value.toFixed(0)} ${unit}`;
}

/** A portion change rescales an effective vector by `factor` (the model's linear rule: non-positive factors collapse to the absent-data zero). */
function scaleVector(vector: NutrientVector, factor: number): NutrientVector {
  const out = {} as NutrientVector;
  for (const key of Object.keys(vector) as Nutrient[]) {
    out[key] = !(factor > 0) ? 0 : Math.max(0, vector[key] * factor);
  }
  return out;
}

/** Two decimals is past any displayed precision; keeps a scaled vector from rendering a long float. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The review editor. `entry` absent = a new meal (the `/meals/entry/new` photo
 * and manual doors); `date` is the client's resolved `YYYY-MM-DD` (lesson 0019);
 * `nutrition` is the plain-JSON display data derived from `@life/nutrition` on
 * the server, so the package never enters the browser bundle (plan Task 14).
 */
export function MealEditor({
  entry,
  date,
  nutrition,
}: {
  entry: MealEntry | null;
  date: string;
  nutrition: NutritionFields;
}) {
  const router = useRouter();
  const [items, setItems] = useState<EditorItem[]>(
    entry
      ? [
          {
            dish: entry.foodId,
            quantity: entry.quantity,
            nutrients: entry.nutrients,
            known: nutrition.fields.map(({ key }) => key),
          },
        ]
      : [{ dish: '', quantity: 1, nutrients: nutrition.empty, known: [] }],
  );
  const [mealGroup, setMealGroup] = useState<MealGroup>(entry?.mealGroup ?? 'lunch');
  const [hint, setHint] = useState('');
  const [mealName, setMealName] = useState('');
  const [estimating, setEstimating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingMeal, setSavingMeal] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [mealSaved, setMealSaved] = useState(false);

  // One rule for "there is a confirmed number here": calories are known for
  // every item. It gates the save actions and the frozen snapshot.
  const caloriesKnown =
    items.length > 0 && items.every((item) => item.known.includes('calories'));
  const canSave = caloriesKnown && items.every((item) => item.dish.trim() !== '');

  /**
   * The day's number the editor itself will store: the sum of the confirmed
   * items' calories, rendered through the server-passed unit (the `@life/nutrition`
   * formatter's calories rule, mirrored in `totalDisplay`). An item the user has
   * not confirmed contributes its absent-data zero (the service's storage rule),
   * so this never differs from what the day view reads back — one convention, not
   * a second display for the same figure. The "no invented numbers" rule lives on
   * the fields: an unconfirmed value renders the em dash, never a `0`.
   */
  const total = totalDisplay(
    items.reduce((acc, item) => acc + item.nutrients.calories, 0),
    nutrition.totalUnit,
    nutrition.unknown,
  );

  function updateItem(index: number, patch: Partial<EditorItem>) {
    setItems((previous) =>
      previous.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }

  /**
   * Correcting a value confirms it; the field stops rendering the em dash.
   * Clearing it returns the field to unknown (stored as the absent-data zero,
   * displayed as the em dash) — an empty box is never a fabricated `0`.
   */
  function correctValue(index: number, key: Nutrient, raw: string, item: EditorItem) {
    if (raw.trim() === '') {
      updateItem(index, {
        nutrients: { ...item.nutrients, [key]: 0 },
        known: item.known.filter((k) => k !== key),
      });
      return;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return;
    updateItem(index, {
      nutrients: { ...item.nutrients, [key]: round2(value) },
      known: item.known.includes(key) ? item.known : [...item.known, key],
    });
  }

  /** A portion change rescales the effective vector by the same ratio (see `scaleVector`). */
  function setPortion(index: number, raw: string, item: EditorItem) {
    const next = Number(raw);
    // An empty or junk portion keeps the last good one — it must never scale the
    // vector to zero (which would silently erase the correction).
    if (!Number.isFinite(next) || next < 0) return;
    const factor = item.quantity > 0 ? next / item.quantity : 0;
    updateItem(index, { quantity: next, nutrients: scaleVector(item.nutrients, factor) });
  }

  function removeItem(index: number) {
    setItems((previous) => previous.filter((_, i) => i !== index));
  }

  function addItem() {
    setItems((previous) => [
      ...previous,
      { dish: '', quantity: 1, nutrients: nutrition.empty, known: [] },
    ]);
  }

  /**
   * The photo door: one call site through `actions.ts`. A readable result seeds
   * the editor's item values; an unreadable one opens manual mode — one empty
   * item, every field unknown, no numbers.
   */
  async function onPhoto(files: FileList) {
    const file = files[0];
    if (!file) return;
    const form = new FormData();
    form.set('image', file);
    if (hint.trim() !== '') form.set('hint', hint);
    setEstimating(true);
    try {
      const result = await estimatePhotoAction(form);
      if (result.readable) {
        setItems(
          result.items.map((suggestion) => ({
            dish: suggestion.dish,
            quantity: 1,
            nutrients: suggestion.nutrients,
            known: nutrition.fields.map(({ key }) => key),
          })),
        );
        setPhotoFailed(false);
      } else {
        setItems([{ dish: '', quantity: 1, nutrients: nutrition.empty, known: [] }]);
        setPhotoFailed(true);
      }
    } catch {
      setItems([{ dish: '', quantity: 1, nutrients: nutrition.empty, known: [] }]);
      setPhotoFailed(true);
    } finally {
      setEstimating(false);
    }
  }

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await saveEntryAction(entry?.id ?? null, {
        date,
        mealGroup,
        expectedVersion: entry?.version ?? 0,
        items: items.map(({ dish, quantity, nutrients }) => ({ dish, quantity, nutrients })),
      });
      router.back();
    } catch {
      setSaving(false);
    }
  }

  async function saveAsMeal() {
    if (!canSave || savingMeal) return;
    setSavingMeal(true);
    try {
      const name = mealName.trim() !== '' ? mealName : items[0].dish;
      await saveAsMealAction(
        name,
        mealGroup,
        items.map(({ dish, quantity, nutrients }) => ({
          foodId: dish.slice(0, FOOD_ID_MAX),
          quantity,
          nutrients,
        })),
      );
      setMealSaved(true);
      setSavingMeal(false);
    } catch {
      setSavingMeal(false);
    }
  }

  return (
    <EditorChrome
      back={{ label: 'Back', onBack: () => router.back() }}
      title={entry ? 'Review meal' : 'Log meal'}
      actions={
        <IconButton
          label="Save meal"
          onClick={save}
          disabled={!canSave || saving}
        >
          <Check size={20} aria-hidden />
        </IconButton>
      }
      banner={
        photoFailed && (
          <AlertBanner>
            Couldn&apos;t read that photo. Enter the meal by hand — nothing was guessed.
          </AlertBanner>
        )
      }
    >
      <Section label="Add from photo — optional steering hint, never a correction">
        <FilePicker label="Choose a photo" accept="image/*" onFiles={onPhoto}>
          <Camera size={20} aria-hidden />
        </FilePicker>
        <Textarea
          aria-label="Photo hint (optional)"
          placeholder="Steer the guess (optional), e.g. leftover from last night"
          value={hint}
          onChange={(event) => setHint(event.target.value)}
        />
        {estimating && <StatusText>Reading the photo…</StatusText>}
      </Section>

      <Section label="Meal">
        <Select
          aria-label="Meal"
          value={mealGroup}
          onChange={(event) => setMealGroup(event.target.value as MealGroup)}
          options={GROUPS}
        />
      </Section>

      <Section label="Items" actions={<Button size="bare" onClick={addItem}>Add item</Button>}>
        {items.length === 0 ? (
          <EmptyState body="Nothing to review yet. Add an item or send a photo." />
        ) : (
          <List>
            {items.map((item, index) => (
              <ListItem
                key={index}
                title={item.dish !== '' ? item.dish : 'New item'}
                deleteAction={
                  <IconButton label={`Remove ${item.dish || 'item'}`} onClick={() => removeItem(index)}>
                    <Trash2 size={18} aria-hidden />
                  </IconButton>
                }
              >
                <Input
                  aria-label={`Dish for item ${index + 1}`}
                  placeholder="Dish name"
                  value={item.dish}
                  onChange={(event) => updateItem(index, { dish: event.target.value })}
                />
                <Input
                  type="number"
                  inputMode="decimal"
                  aria-label={`Portions for ${item.dish || `item ${index + 1}`}`}
                  value={String(item.quantity)}
                  onChange={(event) => setPortion(index, event.target.value, item)}
                />
                {nutrition.fields.map(({ key, label }) => {
                  const known = item.known.includes(key);
                  return (
                    <Input
                      key={key}
                      type="number"
                      inputMode="decimal"
                      aria-label={`${label} for ${item.dish || `item ${index + 1}`}`}
                      placeholder={nutrition.unknown}
                      value={known ? String(round2(item.nutrients[key])) : ''}
                      onChange={(event) => correctValue(index, key, event.target.value, item)}
                    />
                  );
                })}
              </ListItem>
            ))}
          </List>
        )}
      </Section>

      <Section label="Total">
        <StatusText>{total}</StatusText>
      </Section>

      <Section label="Save as meal">
        <Input
          aria-label="Meal name"
          placeholder={items[0]?.dish || 'Meal name'}
          value={mealName}
          onChange={(event) => setMealName(event.target.value)}
        />
        <Button onClick={saveAsMeal} disabled={!canSave || savingMeal}>
          Save as meal
        </Button>
        {mealSaved && <StatusText>Saved to your meals.</StatusText>}
      </Section>
    </EditorChrome>
  );
}
