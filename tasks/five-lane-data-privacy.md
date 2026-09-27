# Five-Lane Gate: data-privacy (note-content encryption at rest)

Branch: `feature/data-privacy` · Range: `master..HEAD` (52f6a9c..f3dc4aa)
Plan: `tasks/plan-data-privacy.md` · Ledger: `tasks/todo-data-privacy.md`

## Final verdict: **N/N — MERGEABLE** (merge parked: user's explicit request only)

Trail: suite gate green (crypto 35/35 + note-service 110/110; typecheck clean) →
lanes 1–5 fired in parallel over one shared context block → lanes 2 & 5 FAIL
(one shared HIGH defect + ledger-accuracy MEDIUMs) → exactly one fix pass
(`f3dc4aa`, `tests_pass=true`) → failed lanes re-run → **5/5 PASS**.

| Lane | Round 1 | After fix pass |
|---|---|---|
| 1 correctness / domain | PASS_WITH_NITS | (stands) |
| 2 code quality | **FAIL** (1 HIGH) | PASS_WITH_NITS |
| 3 security | PASS | (stands) |
| 4 QA / coverage | PASS_WITH_NITS | (stands) |
| 5 plan conformance | **FAIL** (1 HIGH + 3 M/H/M) | PASS_WITH_NITS |

## The blocker the gate caught (worth remembering)

`resolveDbPath` in the ops scripts defaulted to `data/life.db` anchored at
`INIT_CWD`, so the documented repo-root deploy command
(`npm run backfill-encrypt -w @life/note-service`) would have opened
`<repo>/data/life.db` — **the production migration would have run against a
nonexistent/empty DB instead of the production data**. The unit tests missed it
because they inject a DataSource and never exercised the CLI default. Fixed by a
shared cwd-independent helper (`src/keys/db.ts`, package-anchored default) + a
path-resolution regression suite. This is the strongest argument for the gate:
the code was green everywhere and still wrong at the exact moment that matters.

## Lane notes (nits, non-blocking)

- Lane 1: tags-only PATCH on a legacy row leaves that body plaintext (the backfill
  is the converter); malformed cursor → empty page (silent-failure edge); prefix
  dual-read misclassifies a plaintext starting literally `enc.v1.` (fails closed);
  backfill batches not globally atomic; tag dedupe read-then-write (single-user).
- Lane 2: AAD/DDL contracts duplicated across modules (drift surface);
  `toDto`/`decodeCachedNoteRow` duplication; scripts not covered by root typecheck;
  `keys?` optional ctor arg is vestigial; DEK memo has no shutdown clear.
- Lane 3: tag AAD omits row identity (documented trade-off, upgrade path in D4);
  `_legacy_` sentinel collision theoretically possible (subs are UUIDs).
- Lane 4: the one `apps/app` diff line is Dockerfile workspace plumbing (required
  by `npm ci`), not UI — ledger wording corrected to "zero UI diff".
- Lane 5: legit plaintext beginning `enc.v1.` is prefix-skipped by the backfill
  (documented idempotence trade-off); this report file was the last open cite.

## Security posture (lane 3, zero C/H/M)

NIST CAVP KAT + HKDF pin independently recomputed; fresh 96-bit nonce per
encryption; AAD bound per field; key material never logged/errored/tracked;
ciphertext-only Redis (AOF) with `cacheable` tripwires; fail-closed decrypt paths
with ids-only logs; zero third-party crypto.

## Machine record

```json
{"gate":"MERGEABLE","score":"5/5","merge_condition":"N/N","merge_status":"PARKED_AWAITING_USER_EXPLICIT_REQUEST","suite":"crypto 35/35 + note-service 110/110 + typecheck clean","fix_pass":"f3dc4aa (tests_pass=true)","human_run_required":"production backfill + deploy (see SPEC-notes-backfill.md checklist)"}
```

## Next

Merge to `master` happens only on the user's explicit request. Deployment is
human-run (AGENTS.md §8: production data migrations and deploys): generate the
production `NOTE_MASTER_KEY`, stop the stack, backup the DB file, dry-run, apply,
boot, phone check — checklist verbatim in `apps/note-service/scripts/encrypt-backfill.ts`
header and `docs/specs/SPEC-notes-backfill.md`.
