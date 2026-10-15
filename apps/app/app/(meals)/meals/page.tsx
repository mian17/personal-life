import { getToday } from '@/lib/today';
import { mealDay } from './day';

export const dynamic = 'force-dynamic';

/** Today: the day comes from the shared owner `getToday()` (never a second derivation, lesson 0016). */
export default async function MealsPage() {
  const today = await getToday();
  return mealDay(today, 'No meals logged today.');
}
