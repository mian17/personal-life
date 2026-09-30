# 0005 — Each route is its own app; sign-in returns to the originating route

- **Date:** 2026-10-01
- **Source:** user feedback on the login flow / PWA install

## Feedback

> "i would want each route to be separate apps, but the re routing is currently
> always routing back to the todos app. for example, i save a PWA on my phone,
> when i enter todo app, if i have to sign in, i expect it to be login to route
> me to todo route, currently i think the behavior is always routing to notes
> app, this is not the behavior that i want."

## Lesson

Each top-level route (`/notes`, `/todos`, …) is treated as its own app:

1. **Its own PWA identity** — a saved PWA for a route opens and stays in that
   route (per-route `start_url`/`scope`), not the whole frontend.
2. **Its own post-auth landing** — an unauthenticated visit to a route must be
   returned to *that same route* after sign-in. The requested destination travels
   through the whole login chain (frontend → IDP → callback) and is honoured.
3. **No hard-coded global landing** — nothing may overwrite the requested route
   with a fixed default app.

## Applies to

Auth/redirect flow, session/callback handling, and the PWA manifest(s).
