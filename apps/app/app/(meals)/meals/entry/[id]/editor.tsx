'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Check, Trash2 } from 'lucide-react';
import type { Nutrient, NutrientVector } from '@life/nutrition';
import {
  AlertBanner,
  Button,
  Card,
  Dialog,
  EditorChrome,
  EmptyState,
  Facts,
  FactsRow,
  FilePicker,
  formatDayMonth,
  formatWeekday,
  IconButton,
  Input,
  Kpi,
  List,
  ListItem,
  Section,
  Select,
  SettingsRow,
  StatusText,
  Textarea,
  useSnackbar,
} from '@life/ui';
import type { MealEntry, MealFood, MealGroup, PhotoEstimateItem, PhotoFailureReason } from '@/lib/meal-api';
import { estimatePhotoAction, saveAsMealAction, saveEntryAction } from './actions';
import { FoodSearch, type PickerFood } from './food-picker';

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

/** One nutrient as the server sends it: the key, the `@life/nutrition` label, and its unit. */
export interface NutrientField {
  key: Nutrient;
  label: string;
  unit: string;
}

/**
 * The nutrition display data the server page derives from `@life/nutrition`.
 * Plain JSON, so it crosses the server/client boundary without the package.
 */
export interface NutritionFields {
  /** The fields the review step shows inline, in display order, with their package labels and units. */
  fields: readonly NutrientField[];
  /** The seven groups of the expanded `All nutrients` region (app-owned grouping, package labels/units). */
  groups: readonly { title: string; fields: readonly NutrientField[] }[];
  /** The number of nutrients outside the inline headline (23), for the expanded region's summary hint. */
  extraCount: number;
  /** The unknown affordance: an estimated-but-unknown value renders this, never `0`. */
  unknown: string;
  /** The all-zero vector: the stored meaning of "no value", never a displayed number. */
  empty: NutrientVector;
  /** The unit the run total renders in (the calories unit on the server). */
  totalUnit: string;
}

/** The two doors the day view's FAB offers: photo capture and the manual catalog picker. */
export type MealDoor = 'photo' | 'food';

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
 * A photo estimate is a complete 27-nutrient vector (`gemini.client.ts` requires
 * all 27), so every field renders its real number. The set is seeded from the
 * groups, not the 4-field headline, so the micros the pipeline produced are not
 * silently discarded.
 */
function estimatedKeys(nutrition: NutritionFields): Nutrient[] {
  return nutrition.groups.flatMap((group) => group.fields.map(({ key }) => key));
}

/**
 * The short label the spec gives the inline headline row (`Carbs (g)`, not the
 * package's `Carbohydrates`); every other label is the package's own. Unit comes
 * from the package — this only shortens the one name the spec spells short.
 */
function inlineLabel(label: string): string {
  return label === 'Carbohydrates' ? 'Carbs' : label;
}

/**
 * True when the item's `known` set covers every non-headline nutrient — the
 * fingerprint of a photo estimate (which seeds all 27). A manual item (empty set)
 * or a restored entry (headline only) is never "estimated".
 */
function isEstimated(item: EditorItem, nutrition: NutritionFields): boolean {
  const headline = new Set(nutrition.fields.map(({ key }) => key));
  return estimatedKeys(nutrition)
    .filter((key) => !headline.has(key))
    .every((key) => item.known.includes(key));
}

/**
 * One reviewed item. `nutrients` is the **effective** vector (already scaled by
 * `quantity`) — the exact value that persists, so a correction and its saved
 * snapshot can never disagree. `quantity` stays servings (the model's own
 * meaning); the `Grams` box is a view over it through `servingGrams`, so a
 * weight is entered without redefining what the entry stores.
 */
export interface EditorItem {
  dish: string;
  /** The catalog food the estimate resolved to, or `null` — the log path's reuse reference (never persisted here). */
  foodId: string | null;
  /** The food's base weight; 100 for every food this feature creates, a referenced food's own base otherwise. */
  servingGrams: number;
  quantity: number;
  nutrients: NutrientVector;
  /** Fields the user has confirmed; everything else renders the unknown em dash. */
  known: readonly Nutrient[];
}

/**
 * The run total as `Kpi`'s two slots — the figure alone and the unit the server
 * passed. The number follows the server's formatter rule (whole kcal); a
 * non-finite/negative sum renders the unknown em dash, never a fabricated `0`.
 */
function totalDisplay(
  value: number,
  unit: string,
  unknown: string,
): { value: string; unit: string } {
  if (!Number.isFinite(value) || value < 0) return { value: unknown, unit };
  return { value: value.toFixed(0), unit };
}

/**
 * The macro facts the reference draws once for the meal, in its order. Keys
 * absent from the headline field list are skipped, so this never invents a row.
 */
const FACT_KEYS: readonly Nutrient[] = ['protein', 'carbohydrates', 'fat'];

/** A portion change rescales an effective vector by `factor` (the model's linear rule: non-positive factors collapse to the absent-data zero). */
function scaleVector(vector: NutrientVector, factor: number): NutrientVector {
  const out = {} as NutrientVector;
  for (const key of Object.keys(vector) as Nutrient[]) {
    out[key] = factor <= 0 ? 0 : Math.max(0, vector[key] * factor);
  }
  return out;
}

/** True when no field resolved a value — the absent-data zero vector, which renders as unknown, never as a fabricated `0`. */
function isZeroVector(vector: NutrientVector): boolean {
  return Object.values(vector).every((value) => value === 0);
}

/** Two decimals is past any displayed precision; keeps a scaled vector from rendering a long float. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A resolved estimate as the item the editor reviews: the wire item's grams
 * become servings through its own base, and the per-serving vector scales to
 * the same effective weight. A path-3 all-zero vector keeps an empty `known`
 * set, so every field renders the unknown em dash — never a fabricated `0`.
 */
function toEditorItem(estimate: PhotoEstimateItem, nutrition: NutritionFields): EditorItem {
  const quantity = estimate.servingGrams > 0 ? estimate.grams / estimate.servingGrams : 1;
  const nutrients = scaleVector(estimate.nutrients, quantity);
  return {
    dish: estimate.name,
    foodId: estimate.foodId,
    servingGrams: estimate.servingGrams,
    quantity,
    nutrients,
    known: isZeroVector(nutrients) ? [] : estimatedKeys(nutrition),
  };
}

/**
 * The items the editor opens with. A restored entry reviews its stored row; the
 * manual door starts empty (every confirmed pick appends); any other door seeds
 * one blank review row.
 */
function initialItems(
  entry: MealEntry | null,
  manual: boolean,
  foodName: string | undefined,
  nutrition: NutritionFields,
): EditorItem[] {
  if (entry) {
    return [
      {
        // The dish name comes from the page (resolved against the catalog); a
        // pre-feature entry — whose `foodId` *is* the dish name — falls back to
        // `entry.foodId`. Never the raw id as a label. The entry stores no base,
        // so the grams view reads 100.
        dish: foodName ?? entry.foodId,
        foodId: null,
        servingGrams: 100,
        quantity: entry.quantity,
        nutrients: entry.nutrients,
        // An existing entry's stored vector cannot say which fields the user
        // confirmed, so only the headline is treated as known — the same rule
        // the editor had before the expanded region existed.
        known: nutrition.fields.map(({ key }) => key),
      },
    ];
  }
  if (manual) return [];
  return [
    { dish: '', foodId: null, servingGrams: 100, quantity: 1, nutrients: nutrition.empty, known: [] },
  ];
}

/**
 * The banner the photo section shows for a failure reason: the photo's own
 * failures (`no-image`, `could-not-read`) keep the frozen copy, a service
 * failure (`service-unavailable`) gets the outage sibling, and no failure shows
 * nothing.
 */
function photoBannerFor(reason: PhotoFailureReason | null): string | null {
  if (reason === null) return null;
  if (reason === 'service-unavailable') {
    return 'Photo service is unavailable. Enter the meal by hand — nothing was guessed.';
  }
  return "Couldn't read that photo. Enter the meal by hand — nothing was guessed.";
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
  foodName,
  door = null,
  foods = [],
  defaultMealGroup,
}: Readonly<{
  entry: MealEntry | null;
  date: string;
  nutrition: NutritionFields;
  /** A restored entry's dish name, resolved against the catalog by the page. */
  foodName?: string;
  /** Which manual door opened this editor; `'food'` logs by catalog search (no photo section). */
  door?: MealDoor | null;
  /** The server-derived group a new entry starts on (the client's local hour); `'lunch'` outside a request scope. */
  defaultMealGroup?: MealGroup;
  /** The catalog the `'food'` door picks from, with per-100 facts the page formatted. */
  foods?: PickerFood[];
}>) {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  // The manual door logs by search: the editor starts empty and every confirmed
  // pick appends, while every other door keeps its single pre-seeded review row.
  const manual = door === 'food' && entry === null;
  const [items, setItems] = useState<EditorItem[]>(() =>
    initialItems(entry, manual, foodName, nutrition),
  );
  const [mealGroup, setMealGroup] = useState<MealGroup>(
    entry?.mealGroup ?? defaultMealGroup ?? 'lunch',
  );
  const [hint, setHint] = useState('');
  const [mealName, setMealName] = useState('');
  const [estimating, setEstimating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingMeal, setSavingMeal] = useState(false);
  // The reason the last photo attempt failed — `null` means the last attempt
  // succeeded (or there was none). A failed attempt always opens the same
  // empty draft; the reason selects only the banner text.
  const [photoFailure, setPhotoFailure] = useState<PhotoFailureReason | null>(null);

  // The photo's own failures (`no-image`, `could-not-read`) keep the frozen
  // banner; a service failure (`service-unavailable`) gets the outage sibling.
  const photoBanner = photoBannerFor(photoFailure);
  // Which item's full-screen nutrients modal is open, by index — one open at a
  // time, and no item is the "no item" sentinel `null`.
  const [openNutrients, setOpenNutrients] = useState<number | null>(null);

  // One rule for "there is a confirmed number here": calories are known for
  // every item. It gates the save actions and the frozen snapshot.
  const caloriesKnown =
    items.length > 0 && items.every((item) => item.known.includes('calories'));
  // A zero-quantity item agrees with Task 11's log path: the log path divides the
  // confirmed effective vector by `quantity` to recover the per-100 g base, so
  // `quantity <= 0` would divide by zero and yield `NaN`/`Infinity`. Such an item
  // is never sent down the create path — it blocks save here, where Task 11 states the same guard.
  const canSave =
    caloriesKnown &&
    items.every((item) => item.dish.trim() !== '' && item.quantity > 0);

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

  /** A servings change rescales the effective vector by the ratio between old and new servings. */
  function setPortion(index: number, servings: number, item: EditorItem) {
    // Empty or junk input arrives as `NaN` (or a negative) and keeps the last good
    // value — it must never scale the vector to zero, which would silently erase
    // the correction. A zero weight is a real answer, and `canSave` blocks it.
    if (!Number.isFinite(servings) || servings < 0) return;
    const factor = item.quantity > 0 ? servings / item.quantity : 0;
    updateItem(index, { quantity: servings, nutrients: scaleVector(item.nutrients, factor) });
  }

  /** The `Grams` box is a view over `quantity`: the typed weight over the item's own base is servings. */
  function setGrams(index: number, raw: string, item: EditorItem) {
    setPortion(index, Number(raw) / item.servingGrams, item);
  }

  function removeItem(index: number) {
    setItems((previous) => previous.filter((_, i) => i !== index));
  }

  function addItem() {
    setItems((previous) => [
      ...previous,
      { dish: '', foodId: null, servingGrams: 100, quantity: 1, nutrients: nutrition.empty, known: [] },
    ]);
  }

  /**
   * The manual-log door's seeding path (`SPEC-manual-log-ui`): each picked
   * food × amount is appended as one confirmed item — catalog facts the user
   * already trusted, snapshotted at the confirmed quantity — so the review step
   * carries real numbers with `known` at headline depth. Appending is the point:
   * the search stays open for the next food and the save path already writes one
   * row per item.
   */
  function confirmFood(food: MealFood, quantity: number): void {
    // The entry stores the **per-serving** vector scaled by the logged quantity;
    // `scaleVector` is the same linear rule `@life/nutrition`'s `scale()` runs,
    // kept local so the package never enters the browser bundle (plan Task 14).
    const nutrients = scaleVector(food.nutrients, quantity);
    setItems((prev) => [
      ...prev,
      {
        dish: food.name,
        foodId: food.id,
        servingGrams: food.servingGrams,
        quantity,
        nutrients,
        known: nutrition.fields.map(({ key }) => key),
      },
    ]);
  }

  /**
   * The photo door: one call site through `actions.ts`. A readable result seeds
   * the editor's item values; an unreadable one opens manual mode — one empty
   * item, every field unknown, no numbers — with the banner its reason earns.
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
        setItems(result.items.map((item) => toEditorItem(item, nutrition)));
        setPhotoFailure(null);
      } else {
        setItems([{ dish: '', foodId: null, servingGrams: 100, quantity: 1, nutrients: nutrition.empty, known: [] }]);
        setPhotoFailure(result.reason);
      }
    } catch {
      // `estimatePhotoAction` answers a typed failure rather than throwing, so
      // this is a defensive fallback: the call never completed.
      setItems([{ dish: '', foodId: null, servingGrams: 100, quantity: 1, nutrients: nutrition.empty, known: [] }]);
      setPhotoFailure('service-unavailable');
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
        items: items.map(({ foodId, dish, quantity, nutrients }) => ({ foodId, dish, quantity, nutrients })),
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
      setSavingMeal(false);
      // The save feedback is the app's snackbar idiom (one owner for the
      // message), not an inline line that's easy to miss under the button.
      showSnackbar({ message: 'Saved to your meals.' });
    } catch {
      setSavingMeal(false);
    }
  }

  /**
   * One item's nutrients as grouped rows for the full-screen modal — the same
   * field rows the inline form shows, one per key, with the same `known` gate
   * and `correctValue` wiring, only grouped under their sub-heading.
   */
  function nutrientRows(item: EditorItem, index: number, subject: string) {
    return nutrition.groups.map((group) => (
      <Section key={group.title} label={group.title} headingLevel="h3">
        {group.fields.map(({ key, label, unit }) => (
          <SettingsRow
            key={key}
            label={`${label} (${unit})`}
            control={
              <Input
                type="number"
                inputMode="decimal"
                aria-label={`${label} in ${group.title} for ${subject}`}
                placeholder={nutrition.unknown}
                value={item.known.includes(key) ? String(round2(item.nutrients[key])) : ''}
                onChange={(event) => correctValue(index, key, event.target.value, item)}
              />
            }
          />
        ))}
      </Section>
    ));
  }

  /**
   * The meal card's macro totals: the reference draws one `Protein / Carbs / Fat`
   * table for the whole meal, not per item. A key reads as a number only when
   * every item confirmed it — the same rule `caloriesKnown` uses, because a
   * partial sum would present itself as the meal's real macro. Any unconfirmed
   * key keeps the em dash, never a fabricated `0`.
   */
  function mealFacts(items: readonly EditorItem[]) {
    return FACT_KEYS.flatMap((key) => {
      const fact = nutrition.fields.find((field) => field.key === key);
      if (!fact) return [];
      const known = items.length > 0 && items.every((item) => item.known.includes(key));
      const sum = items.reduce((acc, item) => acc + item.nutrients[key], 0);
      const value = known ? `${round2(sum)} ${fact.unit}` : nutrition.unknown;
      return [
        <FactsRow key={key} label={inlineLabel(fact.label)} value={value} />,
      ];
    });
  }

  /**
   * One item's form. Returned as JSX (not a nested component) so the item's
   * controls stay in this render's element tree, where the harness reaches them.
   */
  function itemForm(item: EditorItem, index: number) {
    const subject = item.dish !== '' ? item.dish : `item ${index + 1}`;
    const estimated = isEstimated(item, nutrition);
    // The count comes from the groups, so the trigger can never claim a number
    // the modal does not hold. The estimated tail is built first: a nested
    // template literal inside the outer one reads as a formatting bug.
    const estimatedTail = estimated ? ` · ${nutrition.extraCount} estimated` : '';
    const triggerLabel = `All nutrients (${estimatedKeys(nutrition).length})${estimatedTail}`;
    return (
      <ListItem
        key={index}
        variant="nested"
        title={
          <Input
            aria-label={`Food for item ${index + 1}`}
            placeholder="Food name"
            value={item.dish}
            onChange={(event) => updateItem(index, { dish: event.target.value })}
          />
        }
        titleAction={
          <IconButton label={`Remove ${item.dish || 'item'}`} onClick={() => removeItem(index)}>
            <Trash2 size={18} aria-hidden />
          </IconButton>
        }
      >
        <SettingsRow
          label="Grams"
          control={
            <Input
              type="number"
              inputMode="decimal"
              aria-label={`Grams for ${subject}`}
              value={String(round2(item.quantity * item.servingGrams))}
              onChange={(event) => setGrams(index, event.target.value, item)}
            />
          }
        />
        {nutrition.fields.map(({ key, label, unit }) => (
          <SettingsRow
            key={key}
            label={`${inlineLabel(label)} (${unit})`}
            control={
              <Input
                type="number"
                inputMode="decimal"
                aria-label={`${label} for ${subject}`}
                placeholder={nutrition.unknown}
                value={item.known.includes(key) ? String(round2(item.nutrients[key])) : ''}
                onChange={(event) => correctValue(index, key, event.target.value, item)}
              />
            }
          />
        ))}
        <Button variant="ghost" onClick={() => setOpenNutrients(index)}>
          {triggerLabel}
        </Button>
        <Dialog
          open={openNutrients === index}
          onOpenChange={(open) => { if (!open) setOpenNutrients(null); }}
          title="All nutrients"
          size="sheet"
        >
          {nutrientRows(item, index, subject)}
        </Dialog>
      </ListItem>
    );
  }

  return (
    <EditorChrome
      // Framed: a screen with a real border, like every other editor back control.
      back={{ label: 'Back', variant: 'framed', onBack: () => router.back() }}
      title={entry ? 'Review meal' : 'Log meal'}
      sub={`${formatWeekday(date)}, ${formatDayMonth(date)}`}
      actions={
        <IconButton
          label="Save meal"
          variant="framed"
          onClick={save}
          disabled={!canSave || saving}
        >
          <Check size={20} aria-hidden />
        </IconButton>
      }
      banner={
        photoBanner !== null && (
          <AlertBanner>{photoBanner}</AlertBanner>
        )
      }
    >
      {door !== 'food' && (
        <Section label="Photo">
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
      )}

      <Section label="Meal">
        <Select
          aria-label="Meal"
          value={mealGroup}
          onChange={(event) => setMealGroup(event.target.value as MealGroup)}
          options={GROUPS}
        />
      </Section>

      {manual && <FoodSearch foods={foods} onPick={confirmFood} />}

      <Card>
        <Kpi value={total.value} unit={total.unit} />
        <Facts>{mealFacts(items)}</Facts>
      </Card>

      <Section
        label="Items"
        count={items.length}
        actions={<Button size="bare" onClick={addItem}>Add item</Button>}
      >
        <StatusText>Grams scale the numbers below; a blank value means unknown, not zero.</StatusText>
        {items.length === 0 ? (
          <EmptyState
            body={
              manual
                ? 'Nothing logged yet. Search a food above to add it.'
                : 'Nothing to review yet. Add an item or send a photo.'
            }
          />
        ) : (
          <List>{items.map((item, index) => itemForm(item, index))}</List>
        )}
      </Section>

      <Section label="Save as meal">
        <Input
          aria-label="Meal name"
          placeholder={items[0]?.dish || 'Meal name'}
          value={mealName}
          onChange={(event) => setMealName(event.target.value)}
        />
        <Button variant="ghost" onClick={saveAsMeal} disabled={!canSave || savingMeal}>
          Save as meal
        </Button>
      </Section>
    </EditorChrome>
  );
}
