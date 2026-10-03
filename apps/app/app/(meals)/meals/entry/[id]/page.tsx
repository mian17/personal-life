import 'server-only';
import { loadOrNotFound } from '@life/app-kit';
import {
  NUTRIENT_LABELS,
  NUTRIENTS,
  UNKNOWN,
  type Nutrient,
  type NutrientVector,
} from '@life/nutrition';
import { getMealEntry } from '@/lib/meal-api';
import { getToday } from '@/lib/today';
import { MealEditor, type NutritionFields } from './editor';

export const dynamic = 'force-dynamic';

/** The fields the review step shows and corrects (one display choice, not a unit table). */
const HEADLINE = ['calories', 'fat', 'carbohydrates', 'protein'] as const satisfies readonly Nutrient[];

/**
 * Everything the client editor needs from `@life/nutrition`, derived here as
 * plain JSON: the package is server-side only (plan Task 14 — no `'use client'`
 * component may import it), so the field list with its labels, the unknown
 * affordance, the all-zero vector, and the total's unit cross the server/client
 * boundary as props.
 */
const NUTRITION: NutritionFields = {
  fields: HEADLINE.map((key) => ({ key, label: NUTRIENT_LABELS[key] })),
  unknown: UNKNOWN,
  empty: Object.fromEntries(NUTRIENTS.map(({ key }) => [key, 0])) as NutrientVector,
  totalUnit: NUTRIENTS.find(({ key }) => key === 'calories')!.unit,
};

/**
 * The review-correct editor for one entry (`SPEC-meal-capture-ui` project
 * structure). `new` is the photo/manual create door the day view links to, so
 * it opens an empty, pre-opened editor; any other id is the entry being
 * corrected. The day the entry belongs to comes from the shared `getToday()`
 * owner (lesson 0019) for a new entry, and from the entry itself when editing —
 * this route never derives a day of its own.
 */
export default async function MealEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (id === 'new') {
    const date = await getToday();
    return <MealEditor entry={null} date={date} nutrition={NUTRITION} />;
  }

  const entry = await loadOrNotFound(() => getMealEntry(id));
  return <MealEditor entry={entry} date={entry.date} nutrition={NUTRITION} />;
}
