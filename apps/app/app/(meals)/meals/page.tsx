import { format, sum } from '@life/nutrition';
import { EmptyState, formatDate, List, ListItem, PageShell, PageTitle, StatusText } from '@life/ui';
import { listDayEntries } from '@/lib/meal-api';
import { getToday } from '@/lib/today';

export const dynamic = 'force-dynamic';

/**
 * The meals day view — minimal wiring for Task 14; Task 16 extends it.
 *
 * "Which day now" comes from the existing shared owner `getToday()` (never a
 * second derivation, lesson 0016; the user's zone, not the host clock, lesson
 * 0019), and that resolved day is what the BFF sends the service. Totals are
 * summed with the shared `@life/nutrition` model so the UI can never disagree
 * with the service, and nutrient strings come from its formatter (no app-local
 * unit table).
 */
export default async function MealsPage() {
  const today = await getToday();
  const entries = await listDayEntries(today);
  const total = format('calories', sum(entries.map((e) => e.nutrients)).calories);

  return (
    <PageShell>
      <PageTitle>Meals — {formatDate(today)}</PageTitle>
      <StatusText>{total}</StatusText>
      {entries.length === 0 ? (
        <EmptyState body="No meals logged today." />
      ) : (
        <List>
          {entries.map((entry) => (
            <ListItem
              key={entry.id}
              title={entry.mealGroup}
              meta={format('calories', entry.nutrients.calories)}
            />
          ))}
        </List>
      )}
    </PageShell>
  );
}
