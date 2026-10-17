import 'server-only';
import { cookies } from 'next/headers';
import { todayIso, todayIsoInZone } from '@life/ui';
import type { MealGroup } from '@/lib/meal-api';

/** Cookie carrying the browser's IANA timezone (`<TimeZoneSync>`). */
export const TZ_COOKIE = 'tz';

/**
 * The zone used before the client cookie lands (first request). Must match the
 * backend's `TODO_TIMEZONE` so SSR "today" agrees with stored due dates
 * (SPEC-todo-due-repeat-notify timezone model).
 */
export const FALLBACK_TZ = process.env.TODO_TIMEZONE ?? 'Asia/Ho_Chi_Minh';

function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The client's zone for this request: the `tz` cookie when it names a real
 * zone, `FALLBACK_TZ` otherwise, and `''` outside a request scope.
 */
async function clientZone(): Promise<string> {
  try {
    const zone = (await cookies()).get(TZ_COOKIE)?.value;
    return zone && isValidTimeZone(zone) ? zone : FALLBACK_TZ;
  } catch {
    return '';
  }
}

/**
 * The user's "today" (`YYYY-MM-DD`) — the single owner of the request day.
 * Reads the browser zone from the `tz` cookie; falls back to `FALLBACK_TZ`,
 * and finally (outside request scope, e.g. unit tests) to the host day.
 */
export async function getToday(): Promise<string> {
  const zone = await clientZone();
  return zone === '' ? todayIso() : todayIsoInZone(zone);
}

/**
 * The client's hour `0..23` at `date` — the zone-aware clock the meal group is
 * derived from, so no client `useEffect`/`new Date()` runs (hydration mismatch).
 */
export function hourInZone(timeZone: string, date: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
}

/**
 * The meal group a local hour defaults to: breakfast 05:00–10:59, lunch
 * 11:00–14:59, dinner 15:00–19:59, snack 20:00–04:59.
 */
export function mealGroupForHour(hour: number): MealGroup {
  if (hour >= 5 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 15 && hour < 20) return 'dinner';
  return 'snack';
}

/**
 * The client's likely meal group right now, derived server-side from the cookie
 * zone and the current instant. Outside a request scope the host's hour stands in.
 */
export async function getDefaultMealGroup(): Promise<MealGroup> {
  const zone = await clientZone();
  return mealGroupForHour(zone === '' ? new Date().getHours() : hourInZone(zone));
}
