import { mealDay } from '../day';

export const dynamic = 'force-dynamic';

/**
 * A specific day: the same day view as today, for the route's `[date]` day —
 * the URL carries the client's resolved `YYYY-MM-DD` (lesson 0019), so this
 * route never derives a day of its own.
 */
export default async function MealDatePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  return mealDay(date, 'No meals logged on this day.');
}
