# 0019 — "Today" is the client's timezone, never the server's clock

**Summary:** Any "today"/Today-Tomorrow/overdue/relative-date decision must be computed in the **client's** timezone — the server process clock is not the user's day; the client passes its timezone (or local date) to the backend and every `today` uses it.

- **Date:** 2026-10-03
- **Source:** user feedback after selecting a due date equal to their local day and seeing it labelled "Tomorrow"

## Feedback

> "bug, i selected 3rd october 2026, today is 3rd october 2026 12:24 am in vietnam but task
> recognize as tomorrow, client should passed locale client backend, save lesson learned"

## What it corrected

`todayIso()` (`packages/ui/src/lib/date-parts.ts`) built the calendar day from the **host**
clock (`new Date().getFullYear()/getMonth()/getDate()`). The todos pages call it during
**SSR**, so "today" was the **server's** day. Production runs UTC; at 00:24 on 2026-10-03 in
Vietnam (UTC+7) the server is still on 2026-10-02. A todo due `2026-10-03` was therefore
compared against `today = 2026-10-02` and rendered as "Tomorrow" (and, for open rows, bucketed
`later`, so it would not even show). The browser never corrected it because the server-computed
`today` is passed down as a prop to the client components.

The date-format rules (lesson 0003) were followed — format came from the ISO calendar parts,
never `toLocale*` — but the **day "now" is** was taken from the wrong clock. The two are
different concerns: *how a date renders* is timezone-safe; *which day the user is in* is not.

## The lesson

- **The user's "today" is their timezone's today.** In any request-rendered app the server
  process clock is the wrong source for it. Compute the day in the client's timezone — either
  in the browser, or from a timezone/locale the client sends.
- **The client passes its timezone to the backend.** Send the IANA zone (e.g.
  `Intl.DateTimeFormat().resolvedOptions().timeZone`) or the client's local `YYYY-MM-DD`, and
  have the server derive `today` from it for every relative label, due bucket, overdue state,
  and any server decision that depends on the user's day (reminders included). One owner for
  "today", parameterised by the client's zone — never `new Date()` host-local in a request path.
- **Date-only parsing stays timezone-proof** (lesson 0003): keep reading `YYYY-MM-DD` from the
  string. This rule is about *which day is now*, not about how a stored date is formatted.
- **Test across the midnight boundary** in a non-UTC zone (e.g. UTC+7 at 00:24): a due date
  equal to the client's local day must render "Today", not "Tomorrow".

## Applies to

Every relative-date decision in the todos app (DueDate today/overdue, `groupTodos` Overdue/
Today buckets, "hidden until due", reminders) and any future per-user app that renders a
relative date. Pairs with lesson 0003 (date formatting) — 0003 says how, 0019 says *whose day*.
