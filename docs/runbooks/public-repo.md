# Public-repo runbook — what has to stay true now that anyone can read this

Publishing the repository changes two things: the history becomes readable by
anyone, and a stranger can open a pull request. Everything below follows from
those two facts.

## The invariant: no job a stranger can start runs on the owner's machine

`runs-on` belongs to the workflow, not to whoever triggered it. A pull request
opened from a fork runs the same job steps as a branch of this repository, on
whatever runner the job names — so a workflow naming a self-hosted runner hands a
stranger's commit the owner's host: its SSH keys, its other checkouts, its
network, its unpublished work. Nothing in a green run's log records that it
happened.

Since v0.2.3 no workflow does that. `.github/workflows/sonarqube.yml` was the only
one: it ran the scan against the SonarQube container on the same host, and it is
deleted. Static analysis for pull requests continues through the SonarCloud GitHub
App, which runs on Sonar's infrastructure and needs no runner of ours; the local
SonarQube container keeps its data and its MCP consumers but receives no CI scan,
so `docs/runbooks/sonar-autofix.md` describes a pipeline that is dormant until a
scan is run by hand.

The runner is still registered, at repository level, and that is the part to
remember:

```bash
gh api repos/mian17/personal-life/actions/runners
# total_count 1 — fedora-sonarqube, online, labels: self-hosted, Linux, X64, sonarqube
```

**It must stay unregistered while the repository is public.** A registered runner
is a runner any workflow may name, and of everything here it is the one mistake
that cannot be undone afterwards: the code has already run. Remove it in Settings
→ Actions → Runners → `fedora-sonarqube` → Remove, or with
`gh api -X DELETE repos/mian17/personal-life/actions/runners/<id>`.

## The tripwire: RULE 7

`scripts/arch-check.mjs` fails when any file under `.github/workflows/` names
`self-hosted`, whatever trigger the job carries — `workflow_dispatch` included,
because a job reachable by hand is still reachable, and an allowlist of triggers is
a second thing to get wrong. It reads the configuration and not the prose: a doc
comment saying "no self-hosted state" is the rule being obeyed, which is why
`tests.yml` and `compose-boot.yml` still say it.

```bash
npm run arch:check     # runs in tests.yml on every PR; exit 0 clean, 1 violations
npm run test:arch
```

It is a tripwire, not a fence: it catches the workflow file, never the runner
registration. Both halves — a registered runner, and a job that names it — have to
be in place before anything runs on the host, so catching either one is enough.

## What a merged contribution still runs

Fork code never touches the host, and merging does not sandbox it either: once a
contribution is in, `npm ci`, the workspace build and every suite run on any
machine that builds the branch, a maintainer's laptop included — where the install
scripts of `better-sqlite3` and `argon2` execute. Reading a dependency addition is
the gate there, and `npm run audit:gate` is the mechanical half of it.

GitHub's gate for the first half is a repository setting:

**Settings → Actions → General → Fork pull request workflows → "Require approval
for all outside collaborators".** Without it a fork's pull request runs its
workflows before anyone here has read a line.

## Secrets in the history

A secret becomes public at the push that carries it. This repository's history
predates the decision to publish it, so every commit still reachable in it turns
readable at the same instant — deleting the line in a later commit leaves the
older commit public.

`.github/workflows/secrets.yml` scans that history on every pull request to `dev`
or `main` and every push to `dev`: `actions/checkout` with `fetch-depth: 0`, then
gitleaks in the official image pinned by digest, mounted read-only, with
`--redact` so a leak never echoes into a public log. The same image and the same
config run locally, with no host install:

```bash
npm run secrets
```

It reads committed history, so run it after committing and before pushing. Both
mounts — the repository and its common git directory — are read-only: this
repository is worked in linked worktrees often enough that a scan which quietly
found no repository (0 commits scanned, exit 0) would be worse than no gate at
all.

### The allowlist policy

`.gitleaks.toml` extends the default rule set and carries exactly one entry:
`packages/crypto/test/envelope.test.ts`, whose `generic-api-key` finding is a
published NIST/CAVP AES-GCM known-answer vector, not a credential.

An entry is allowed when it names a **path** and carries a **reason a reader can
check** — that file cites the vector and its section above the constant. A regex
over the repository, or a path wide enough to cover the code the key is meant to
protect, is not: it stops reporting the next real finding, which is the only
reason the scan exists. Anything else a scan reports is a finding to act on,
starting with rotating the value.

## Reading a red run

`main` and `dev` have no required status checks — `gh api
repos/mian17/personal-life/branches/dev/protection` answers "Branch not protected"
— so a red `Secrets` job does not block a merge on its own. It has to be read:
open the run, take the rule, file and line, and treat it as a leak until the commit
that introduced it is identified. Rotation comes first and the history rewrite
second, because by the time the scan saw it, the value was already public.
