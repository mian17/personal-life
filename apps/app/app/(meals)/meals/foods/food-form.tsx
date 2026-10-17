'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Trash2 } from 'lucide-react';
import type { Nutrient, NutrientVector } from '@life/nutrition';
import {
  AlertBanner,
  Button,
  ConfirmButton,
  EditorChrome,
  IconButton,
  Input,
  Row,
  Section,
  Select,
  SettingsRow,
  StatusText,
} from '@life/ui';
import type { FoodUnit, MealFood } from '@/lib/meal-api';
import { createFoodAction, deleteFoodAction, updateFoodAction } from '../actions';

/** One nutrient as the server page sends it: the key, its `@life/nutrition` label, and its unit. */
export interface NutrientField {
  key: Nutrient;
  label: string;
  unit: string;
}

/**
 * The nutrition display data the server page derives from `@life/nutrition`
 * (plan Task 14: no `'use client'` component imports the package, so it crosses
 * as plain JSON). Grouping is the app-owned display choice the entry editor
 * shares; every key, label and unit comes from the package.
 */
export interface FoodNutrition {
  /** The seven display groups, in display order; every one of the 27 keys appears once. */
  groups: readonly { title: string; fields: readonly NutrientField[] }[];
}

/** The service's `CreateFoodDto` bounds, owned by `lib/meal-api.ts` and passed down as data. */
export interface FoodFormBounds {
  nameMax: number;
  labelMax: number;
  portionsMax: number;
  amountMax: number;
}

/** One measure as typed: both halves are strings, so a half-filled row can render as typed. */
interface MeasureDraft {
  label: string;
  amount: string;
}

/** The two canonical units a food is created in (`SPEC-food-units`); the choice is final. */
const UNIT_OPTIONS = [
  { value: 'g', label: 'g' },
  { value: 'ml', label: 'ml' },
];

/** Two decimals is past any displayed precision, and keeps a stored float from rendering long. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Every key the form shows, in display order. */
function allKeys(nutrition: FoodNutrition): Nutrient[] {
  return nutrition.groups.flatMap((group) => group.fields.map(({ key }) => key));
}

/** The typed facts as the stored vector: a blank box is the stored "no value" (`0`), never `NaN`. */
function factVector(facts: Record<Nutrient, string>, nutrition: FoodNutrition): NutrientVector {
  const out = {} as NutrientVector;
  for (const key of allKeys(nutrition)) {
    const value = Number(facts[key]);
    out[key] = Number.isFinite(value) ? value : 0;
  }
  return out;
}

/** The starting facts: an edit opens on the stored values, a create on `0` (the stores' "no value"). */
function initialFacts(food: MealFood | null, nutrition: FoodNutrition): Record<Nutrient, string> {
  const facts = {} as Record<Nutrient, string>;
  for (const key of allKeys(nutrition)) facts[key] = String(round2(food?.nutrients[key] ?? 0));
  return facts;
}

/** The stored measures as editable rows. */
function initialMeasures(food: MealFood | null): MeasureDraft[] {
  return (food?.servings ?? []).map((serving) => ({
    label: serving.label,
    amount: String(round2(serving.amount)),
  }));
}

/**
 * The create/edit/delete form for one catalog food (`SPEC-food-catalog-ui`).
 *
 * Create collects the name, the unit (chosen once), the 27 hand-typed per-100
 * facts and zero or more named measures; edit rewrites the same fields with the
 * unit read-only. Nothing here is model-filled — the facts are typed by hand,
 * and a blank box is the stored "no value" `0`, never the unknown affordance.
 *
 * Composition is `@life/ui` only (Contract 1): `EditorChrome` is the frame,
 * `SettingsRow` hosts each `Input`/`Select`/`StatusText`, measures are `Row`s of
 * `Input` + `IconButton` remove, the delete is a `ConfirmButton`. The save is
 * imperative (the toolbar `IconButton`, the entry editor's pattern), so the
 * delete control can never submit the save path by accident.
 */
export function FoodForm({
  food,
  nutrition,
  bounds,
}: {
  /** The food being edited; `null` renders the create form. */
  food: MealFood | null;
  nutrition: FoodNutrition;
  bounds: FoodFormBounds;
}) {
  const router = useRouter();
  const [name, setName] = useState(food?.name ?? '');
  const [unit, setUnit] = useState<FoodUnit>(food?.unit ?? 'g');
  const [facts, setFacts] = useState<Record<Nutrient, string>>(() => initialFacts(food, nutrition));
  const [measures, setMeasures] = useState<MeasureDraft[]>(() => initialMeasures(food));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const portions = measures
    .map((measure) => ({ label: measure.label.trim(), amount: Number(measure.amount) }))
    .filter((portion) => portion.label !== '');
  // A labelled row with an unusable amount would 400 at the service, so the
  // save stays disabled until every row is either blank or a positive number.
  const portionsReady = portions.every(
    (portion) => Number.isFinite(portion.amount) && portion.amount > 0,
  );
  const canSave = name.trim() !== '' && portionsReady && !saving;

  function setFact(key: Nutrient, value: string) {
    setFacts((previous) => ({ ...previous, [key]: value }));
  }

  function addMeasure() {
    setMeasures((previous) =>
      previous.length >= bounds.portionsMax ? previous : [...previous, { label: '', amount: '' }],
    );
  }

  function updateMeasure(index: number, patch: Partial<MeasureDraft>) {
    setMeasures((previous) =>
      previous.map((measure, i) => (i === index ? { ...measure, ...patch } : measure)),
    );
  }

  function removeMeasure(index: number) {
    setMeasures((previous) => previous.filter((_, i) => i !== index));
  }

  async function save(): Promise<void> {
    if (!canSave) return;
    setSaving(true);
    setError('');
    const nutrients = factVector(facts, nutrition);
    try {
      if (food === null) {
        // One POST, the base facts un-scaled at `servingGrams: 100` — the
        // service derives every measure's vector (`SPEC-food-units`).
        await createFoodAction({ name: name.trim(), unit, servingGrams: 100, nutrients, portions });
      } else {
        // No `unit`: it is chosen once and the service's whitelist rejects a change.
        await updateFoodAction(food.id, {
          name: name.trim(),
          nutrients,
          portions,
          expectedVersion: food.version,
        });
      }
      router.push('/meals/foods');
    } catch {
      setSaving(false);
      setError('Could not save the food. Try again.');
    }
  }

  async function remove(): Promise<void> {
    if (food === null) return;
    setError('');
    try {
      await deleteFoodAction(food.id);
      router.push('/meals/foods');
    } catch {
      setError('Could not delete the food. Try again.');
    }
  }

  return (
    <EditorChrome
      back={{ label: 'Back', onBack: () => router.back() }}
      title={food === null ? 'New food' : 'Edit food'}
      actions={
        <IconButton label="Save" onClick={save} disabled={!canSave}>
          <Check size={20} aria-hidden />
        </IconButton>
      }
      banner={error !== '' ? <AlertBanner>{error}</AlertBanner> : null}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          return save();
        }}
      >
        <Section label="Food">
          <SettingsRow
            label="Name"
            control={
              <Input
                aria-label="Food name"
                placeholder="Milk, Brand X"
                maxLength={bounds.nameMax}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            }
          />
          <SettingsRow
            label="Unit"
            description={food === null ? 'Chosen once, for every amount of this food.' : undefined}
            control={
              food === null ? (
                <Select
                  aria-label="Unit"
                  value={unit}
                  options={UNIT_OPTIONS}
                  onChange={(event) => setUnit(event.target.value as FoodUnit)}
                />
              ) : (
                <StatusText>{unit}</StatusText>
              )
            }
          />
          <StatusText>Facts below are per 100 {unit} — a blank value is 0.</StatusText>
        </Section>

        {nutrition.groups.map((group) => (
          <Section key={group.title} label={group.title}>
            {group.fields.map(({ key, label, unit: fieldUnit }) => (
              <SettingsRow
                key={key}
                label={`${label} (${fieldUnit})`}
                control={
                  <Input
                    aria-label={`${label} per 100`}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={facts[key]}
                    onChange={(event) => setFact(key, event.target.value)}
                  />
                }
              />
            ))}
          </Section>
        ))}

        <Section
          label="Measures"
          actions={
            <Button
              size="bare"
              onClick={addMeasure}
              disabled={measures.length >= bounds.portionsMax}
            >
              Add measure
            </Button>
          }
        >
          <StatusText>A named amount in {unit}, e.g. "1 carton" = 1000.</StatusText>
          {measures.map((measure, index) => (
            <Row key={index}>
              <Input
                aria-label={`Measure ${index + 1} label`}
                placeholder="1 carton"
                maxLength={bounds.labelMax}
                value={measure.label}
                onChange={(event) => updateMeasure(index, { label: event.target.value })}
              />
              <Input
                aria-label={`Measure ${index + 1} amount in ${unit}`}
                type="number"
                inputMode="decimal"
                min={1}
                max={bounds.amountMax}
                value={measure.amount}
                onChange={(event) => updateMeasure(index, { amount: event.target.value })}
              />
              <IconButton label={`Remove measure ${index + 1}`} onClick={() => removeMeasure(index)}>
                <Trash2 size={18} aria-hidden />
              </IconButton>
            </Row>
          ))}
        </Section>
      </form>

      {food !== null ? (
        <Section label="Delete">
          <ConfirmButton
            variant="danger"
            message={`Delete ${food.name}? Past entries keep their logged numbers.`}
            onClick={remove}
          >
            Delete food
          </ConfirmButton>
        </Section>
      ) : null}
    </EditorChrome>
  );
}
