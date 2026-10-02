import 'server-only';
import { cookies } from 'next/headers';
import { todayIso, todayIsoInZone } from '@life/ui';

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
 * The user's "today" (`YYYY-MM-DD`) — the single owner of the request day.
 * Reads the browser zone from the `tz` cookie; falls back to `FALLBACK_TZ`,
 * and finally (outside request scope, e.g. unit tests) to the host day.
 */
export async function getToday(): Promise<string> {
  try {
    const zone = (await cookies()).get(TZ_COOKIE)?.value;
    if (zone && isValidTimeZone(zone)) return todayIsoInZone(zone);
    return todayIsoInZone(FALLBACK_TZ);
  } catch {
    return todayIso();
  }
}
