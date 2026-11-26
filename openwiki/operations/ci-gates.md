---
type: 'Reference'
title: 'CI gates'
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-26T10:12:12.781Z
sources:
  - id: openwiki-source-f105d25ee8874743173a2232
    resource: repo://.github/workflows/backmerge.yml
  - id: openwiki-source-579caf3ca45a1d9f960055a7
    resource: repo://.github/workflows/compose-boot.yml
  - id: openwiki-source-6e051f9ccbe3eaf4de48a5cc
    resource: repo://.github/workflows/secrets.yml
  - id: openwiki-source-aa11f7ccdcbf0dd150735c18
    resource: repo://.github/workflows/tests.yml
  - id: openwiki-source-727b56653fd0103b1858eee2
    resource: repo://.gitleaks.toml
  - id: openwiki-source-7cb388000c1223c91d227cd5
    resource: repo://docs/ops/backmerge.md
  - id: openwiki-source-b89119e7088592067b559e81
    resource: repo://docs/runbooks/public-repo.md
  - id: openwiki-source-eed9fbfe3a39f063b4923686
    resource: repo://scripts/arch-check.mjs
  - id: openwiki-source-df63b927665626df07969e67
    resource: repo://scripts/audit-gate.mjs
  - id: openwiki-source-a0b08eaec14a20c6d47f731f
    resource: repo://scripts/ci-compose-env.sh
generated: { by: 'pi', at: '2026-11-26T10:12:12.781Z' }
---

# CI gates

Four workflows, all on GitHub-hosted runners — nothing in CI runs on the owner's
machine. Every workflow file lives in `.github/workflows/`; `npm run arch:check`
enforces that no workflow may ever name a `self-hosted` runner.

| Workflow           | Triggers                              | Runner          | What it proves                                                                                                           |
| ------------------ | ------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `tests.yml`        | PR → `dev`/`main`, manual             | `ubuntu-latest` | The code is clean: lint, dependency audit, arch rules, typecheck, full jest coverage                                     |
| `compose-boot.yml` | PR → `dev`/`main`, push `dev`, manual | `ubuntu-latest` | The deployment works: build the real stack, boot it, every backend answers `/health/ready` **from inside its container** |
| `secrets.yml`      | PR → `dev`/`main`, push `dev`, manual | `ubuntu-latest` | The history carries no secret: gitleaks over every commit, redacted                                                      |
| `backmerge.yml`    | push `main`, manual                   | `ubuntu-latest` | Bookkeeping: opens the `-s ours` back-merge PR so `main` stays an ancestor of `dev`                                      |

One run per PR (a new push supersedes the previous run via a per-PR concurrency
group). `SonarCloud Code Analysis` — a GitHub App, not a workflow — additionally
gates pull requests with taint analysis; the local SonarQube scan was deleted
with v0.2.3 (see [Release and promotion](release.md)).

## tests.yml

In order: `npm ci --ignore-scripts` (Sonar rule S6505 — install scripts are off;
the two native modules `better-sqlite3` and `argon2` are rebuilt explicitly),
`npm run audit:gate`, `npm run lint`, `npm run build`, `npm run typecheck`,
`npm run arch:check`, then `npm run test:coverage` against a throwaway
`postgres:17-alpine` container (pulled before the suite so a cold registry fetch
cannot surface as a hook timeout). Workspace `@life/*` types exist only after a
build, which is why build precedes typecheck and tests.

`audit:gate` (`scripts/audit-gate.mjs`) fails on any high/critical advisory not
in `.github/audit-allowlist.json`, on any allowlist entry npm audit no longer
reports (a rotted exception hides the next one), and on any entry past its
`reviewBy` date.

## compose-boot.yml

Nothing in CI had ever run the deployment when v0.2.1 shipped three dead
features in production with a green test run. This job is the fix: generate a
throwaway env file (`scripts/ci-compose-env.sh` writes every variable the stack
_requires at boot_ — not merely what `docker compose config` interpolates),
validate with `docker compose config`, build the eight images, create the
bind-mount `apps/*/data` directories and chown them to `1000:1000` (a fresh
checkout has none; Docker would create them root-owned while every image runs as
uid 1000), then `up -d --wait`. It asserts each backend's `/health/ready` from
inside its own container — service-to-service reachability over the compose
network, which a host curl cannot show — plus the host-published endpoints, and
dumps ps/logs/health on any outcome. It also asserts the app refuses header-less
traffic (the fail-closed Tailscale access gate answers 403) and that the
identity gate redirects an unauthenticated owner. Always tears down with
`down -v --remove-orphans`.

## secrets.yml

A secret becomes public at the push that carries it, so the scan walks **every
commit** (`fetch-depth: 0`) and runs gitleaks in the official image pinned by
digest (a tag can move), mounted read-only, with `--redact` so a leak never
echoes into a log. `.gitleaks.toml` extends the default rules with exactly one
allowlisted path: `packages/crypto/test/envelope.test.ts`, a published NIST CAVP
AES-GCM known-answer vector. Anything else a scan reports is a finding to act
on, not an entry to add. `npm run secrets` runs the same scan locally.

## backmerge.yml

Promotions `dev → main` are squash-merged, so `main` never records `dev` as
merged and the next promotion would conflict textually. A push to `main` is the
promotion landing; this workflow opens the bookkeeping PR (`git merge -s ours
origin/main`, keeping dev's tree) and waits for a human to merge it with a merge
commit — squashing it would recreate the problem. It needs the repo setting
"Allow GitHub Actions to create and approve pull requests" enabled.

## The no-self-hosted-runner invariant

A `self-hosted` runner label would hand a fork PR's code the owner's machine
(SSH keys, other checkouts, the LAN), and a green run's log would show nothing.
RULE 7 in `scripts/arch-check.mjs` fails when any workflow file names
`self-hosted`, comment-stripped, under any trigger. The repo's only runner
(`fedora-sonarqube`) was unregistered when the repo went public; the verification
command and removal recipe are in `docs/runbooks/public-repo.md`, and
`total_count` must stay `0`.

## See also

- [Deployment and operations](deployment.md) — what compose-boot is booting.
- [Release and promotion](release.md) — CI as a release precondition.
- [Testing strategy](../testing/strategy.md) — what the suites cover underneath
  these gates.
