---
type: 'Reference'
title: 'Deployment and operations'
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-26T10:12:12.781Z
sources:
  - id: openwiki-source-579caf3ca45a1d9f960055a7
    resource: repo://.github/workflows/compose-boot.yml
  - id: openwiki-source-529adad5b98db00ca5c3989c
    resource: repo://apps/meal-service/src/meal-todo.controller.ts
  - id: openwiki-source-e201e686a785f09b6d899f0b
    resource: repo://compose.yaml
  - id: openwiki-source-deb6fbea63cbf581339a73db
    resource: repo://docs/runbooks/production-deploy.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-ae09ab5e302f794c0b01b48b
    resource: repo://packages/db/src/backup-pg.ts
  - id: openwiki-source-7a8d9da2b5092a49a1394068
    resource: repo://packages/db/src/backup.ts
  - id: openwiki-source-eed9fbfe3a39f063b4923686
    resource: repo://scripts/arch-check.mjs
generated: { by: 'pi', at: '2026-11-26T10:12:12.781Z' }
---

# Deployment and operations

Production is Docker Compose on the owner's machine, behind Tailscale. The
authoritative step-by-step is `docs/runbooks/production-deploy.md` (back up →
migrate → boot → verify → steady state → rollback); this page is the model
behind it.

## The stack

`compose.yaml` defines 18 services on one internal `life` network: eight built
images (each with its own `Dockerfile`, `node:24-bookworm-slim` bases), eight
per-service Redis instances, `postgres-feedback` (the one Postgres service) and
`rabbitmq-feedback`. Data lives in bind mounts under each `apps/*/data`
directory plus named volumes for the infra containers. A fresh checkout has no
`data/` directories (they are gitignored), so they must exist and be owned by
uid `1000:1000` before `up` — otherwise Docker creates them root-owned and the
images cannot open their SQLite files.

The app is reached through the Tailscale access gate: `NODE_ENV=production`
arms a fail-closed check that demands the owner's `tailscale-user-login` header,
so a header-less request gets 403 and an unauthenticated owner gets redirected
to the IdP. See [Identity and access](../workflows/identity-and-access.md).

## Env: forwarded, required, never guessed

Each service reads its configuration from env vars with **no code fallback** —
deliberate. A guessed port half-succeeds a write (row saved, message never
sent, nothing logged), so a loud boot refusal naming the missing variable is the
better failure. Consequences for operations:

- Every variable a service reads must be a key in that service's own
  `environment:` block in `compose.yaml` — **arch-check RULE 6** fails the build
  otherwise (it resolves both the `process.env.NAME` and the
  `process.env[CONSTANT]` read shapes).
- The env file `compose.yaml` reads is pinned by its `env_file:` entry. The dev
  stack writes it via `scripts/setup-dev-env.sh`; CI writes a throwaway one via
  `scripts/ci-compose-env.sh`. Key names are in `.env.example` /
  `.env.development.example`; values live only in gitignored files.
- Master keys (`*_MASTER_KEY`, base64) and connection passwords are generated
  per install; URL-bound passwords use hex (base64 `/` breaks URL parsing).

## Backup and restore

`packages/db` ships the CLIs, wired as root scripts:

- `npm run db:backup` / `npm run db:restore` — the six SQLite files
  (`life.db`, tags, todo, idp, meal, focus). `--pin` marks a snapshot as a
  retained point-in-time copy (`backup/<utc-stamp>-pinned/`).
- `npm run db:backup:pg` / `db:restore:pg` — the `feedback` Postgres database
  (`pg_dump`/`pg_restore`, verified via `pg_restore_list=ok`).

Both are wired into cron for routine snapshots (`backup/cron.log` records the
runs), and **the ordering rule is absolute: back up → migrate → boot.** Never
migrate after boot, never `docker compose down -v` during a backup window
(`-v` also removes `redis-app-data`, which holds sessions). Rollback is: stop,
restore the pinned pair, boot the previous images — record the images you are
about to replace (`docker compose images`) before every deploy.

## Health, verification, hard lines

After any deploy, verify from inside the network: every backend answers
`GET /health/ready` with `{"status":"ok"}`, the app answers (403 without owner
headers is correct), and the domain-specific smoke checks in the runbook's §7
pass. Hard lines that are never automated: data directories, secrets, ports,
production deploys and production data migrations — those are run by the human
with the checklist.

## See also

- [Crypto at rest](../architecture/crypto-at-rest.md) — what the backed-up
  files contain and why restore needs the right master keys.
- [CI gates](ci-gates.md) — compose-boot runs this same stack in CI.
- [Release and promotion](release.md) — what lands before a deploy happens.
