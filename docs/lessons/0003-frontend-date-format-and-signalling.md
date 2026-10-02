# 0003 — Frontend dates: dd/mm/yyyy via a shared helper, signal with relative text

**Summary:** Frontend dates: dd/mm/yyyy through one `@life/ui` helper, relative text (Today/Tomorrow) else the date; parse calendar parts from the ISO string, never `toLocale*`.

- **Date:** 2026-10-01
- **Source:** user feedback (todo row date styling)

## Feedback

> "ok with the muted, to signal the user, try using text instead like Today,
> Tomorrow if it is, if it doesn't then use date, also i would want the date
> format across the app on the frontend to be dd/mm/yyyy, use a helper function
> for that"

## Lesson

1. **One helper owns frontend date formatting.** It lives in `@life/ui` (the
   package that owns presentation) and every frontend date read-out routes
   through it. No ad-hoc or locale-dependent formatting anywhere in `apps/*`.
   Implemented as `formatDate` (dd/mm/yyyy, timezone-drift-safe) and
   `dueDateLabel` in `packages/ui/src/lib/format-date.ts`.
2. **Signal with relative text, fall back to the date.** A due date shows
   `Today` / `Tomorrow` when it lands on those days, otherwise the dd/mm/yyyy
   date; a missing due date shows `No date`. Rendered muted — no accent/danger
   colouring.
3. **Timezone safety:** read the calendar parts out of the ISO string; never
   round-trip through `new Date(...).toLocale*`, which can shift the day.

## Applies to

All frontend date rendering (`LocalTime` and every consumer), and any future
date/time presentation.
