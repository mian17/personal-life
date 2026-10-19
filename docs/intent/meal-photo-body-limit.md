# Intent — meal photo upload fails on iPhone in production

## Outcome

A real iPhone photo uploaded from the meal editor reaches `meal-service` and
produces a populated draft. Today it never leaves the Next.js BFF: the Server
Action body ceiling (Next's 1 MB default) rejects the multipart upload with a
413 before `estimatePhotoAction` runs, and the editor renders "Photo service is
unavailable" — a banner naming the wrong cause, because the photo service is
healthy and was never called.

## User

The single user of this self-hosted app, logging a meal from a phone in the
deployed Docker stack. Not a developer with a terminal open; the failure is
visible only to them, as a banner that misattributes the cause. The same code
path is used in development, where test fixtures are small enough to slip under
1 MB, so the defect is production-only.

## Why now

The photo door is the app's main meal-logging affordance and it is currently
100% broken in the deployed stack for the only device class that uses it — a
phone camera. It was verified working against small fixtures and against
`meal-service` in isolation, which is exactly why the BFF ingress limit was
missed. Leaving it also leaves the misleading banner in place, which sends the
next debugging session after the photo service instead of the BFF.

## Success

- A photo larger than 1 MB taken on a phone reaches `meal-service`: its logs show
  `POST /api/estimates/photo` and the editor shows a populated draft.
- The BFF body ceiling is derived from the service's own `JSON_BODY_LIMIT`, with
  a comment tying the two together, so the two limits cannot silently drift
  apart again.
- A failed photo call no longer reports `service-unavailable` for a transport
  rejection that never reached the service; the banner names a cause it can
  support.
- A unit test fails if the Server Action body limit is set below the service's
  own cap, without needing a 1 MB fixture or a running server.
- `docs/runbooks/production-deploy.md`'s photo-door verification step names the
  BFF body limit as a thing to check, not only the Gemini env trio.

## Constraint

The fix is configuration, error mapping and docs in `apps/app` plus one
reference value read from `apps/meal-service`. No change to the photo pipeline's
behaviour when a request does reach the service. No new dependency. Frozen
surfaces are untouched: the e2e selector surface (roles, visible text including
the banner strings, aria-labels, `button.trash-delete`), token values, PWA
constants. Contract 1 applies to any markup touched: compose `@life/ui`, tokens
only, no raw HTML, no `next/link`.

## Out of scope

Changing `IMAGE_MIME_TYPES` — `image/heic` and `image/heif` are already accepted
(`apps/meal-service/src/photo/gemini.client.ts:120-121`), so iPhone HEIC is not
the failure here. Client-side image downscaling or compression before upload.
Accepting phone videos or RAW formats. Moving the photo upload off Server
Actions onto a dedicated upload route. Any change to the Gemini prompt,
response shape, or the frozen failure-reason vocabulary beyond distinguishing a
transport rejection from a service answer.

## Confirmation

Confirmed: yes — the user asked for the issue to be fixed, described the
symptom, confirmed the root cause with production container logs, and asked for
a `code-as-prose`-bound subagent to implement it in a worktree under the
`agents-hard-gates` workflow.
