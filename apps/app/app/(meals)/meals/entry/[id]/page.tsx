import { loadOrNotFound } from '@life/app-kit';
import { getMealEntry } from '@/lib/meal-api';
import { getToday } from '@/lib/today';
import { MealEditor } from './editor';

export const dynamic = 'force-dynamic';

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
    return <MealEditor entry={null} date={date} />;
  }

  const entry = await loadOrNotFound(() => getMealEntry(id));
  return <MealEditor entry={entry} date={entry.date} />;
}
