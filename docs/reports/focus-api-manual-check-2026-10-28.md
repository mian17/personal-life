# Task 8 manual check — `listSessions` from a server component

Post-repair re-run. Both bounds `from`/`to` are client days; the check drives the real
`focus-service` over real HTTP and real Postgres/Redis, not a mock.

## Setup

- `focus-service` booted from `dist/main.js` (rebuilt with `npm run build -w @life/focus-service`)
  on `127.0.0.1:3107`, `NODE_ENV=development` (guard dev-bypass ⇒ principal `sub = dev-user`):
  - `FOCUS_DB_URL=postgresql://postgres:verify@127.0.0.1:5599/focus` — container `focus-verify-pg`
  - `REDIS_URL=redis://127.0.0.1:6399` — container `focus-verify-redis`
  - `FOCUS_MASTER_KEY` — throwaway base64 of 32 dashes
- `next dev` on `127.0.0.1:3100` with `FOCUS_API_URL=http://127.0.0.1:3107`, `REDIS_URL` pointed at
  the same Redis, and one seeded app session (`app:sess:manual-sess-1`) so `requireSession()`
  resolves instead of redirecting to login.
- Temporary server component `apps/app/app/manual-focus-check/page.tsx`:

  ```tsx
  const created = await recordSession('2026-10-02', 25);
  const rows = await listSessions('2026-10-01', '2026-10-07');
  ```

  The page was deleted immediately after the check; it is not part of the change.

## Result

```
$ curl -s -i -b 'app_session=manual-sess-1' http://127.0.0.1:3100/manual-focus-check
HTTP/1.1 200 OK
Cache-Control: no-store
...
<p>created=cde7a3b9-d522-4252-a3a3-308e5b869c24 rows=1</p>
```

Server log line:

```
MANUAL-CHECK listSessions rows= [{"id":"cde7a3b9-d522-4252-a3a3-308e5b869c24","ownerSub":"dev-user","date":"2026-10-02","minutes":25,"createdAt":"2026-10-28T22:40:53.444Z"}]
```

**Status 200, one row returned**, carrying exactly the fields `SessionRow` declares
(`id`, `ownerSub`, `date`, `minutes`, `createdAt`) — so the BFF wire type and the service DTO
agree on the real payload, and `ownerSub` arrives populated even though the column is nullable.

## Cleanup

Temporary page removed, seeded session deleted, both dev processes stopped. Nothing outside the
two throwaway containers and `/tmp` was written.
