'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Kept in sync with the server-only `TZ_COOKIE` in `@/lib/today` (that module
// imports `next/headers`, so the client cannot import the constant).
const TZ_COOKIE = 'tz';

/**
 * Persists the browser's IANA timezone into the `tz` cookie so the server
 * computes "today" in the user's zone (lesson 0019) instead of its own clock.
 * Refreshes once so the first render corrects to the user's day.
 */
export function TimeZoneSync() {
  const router = useRouter();

  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone) return;
    if (document.cookie.split('; ').includes(`${TZ_COOKIE}=${zone}`)) return;
    document.cookie = `${TZ_COOKIE}=${zone};path=/;max-age=31536000;samesite=lax`;
    router.refresh();
  }, [router]);

  return null;
}
