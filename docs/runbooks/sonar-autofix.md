# SonarQube auto-fix

SonarQube webhook → host receiver → pi-sbx sandbox agent → draft pull request.

This pipeline is fed by, and fixes against, the **local SonarQube container** — the
edit-time / pre-commit gate. The repository's Cloud analysis is separate and
**CI-based**: `.github/workflows/tests.yml` runs the scanner on every pull request
into `dev`/`main` and on every push to them, and uploads coverage. Four consequences
worth knowing before reading further:

- **Automatic Analysis must stay off** in SonarCloud. The CI scanner refuses to run
  against a project whose automatic analysis is enabled, so turning it back on
  breaks every scan in the pipeline silently at PR time.
- **Cloud-only rules surface at PR time, not at edit time.** The local container has
  no taint analysis, so log-injection and XSS-style findings appear only in the CI
  scan's result on the pull request. A clean edit-time gate does not mean a clean PR.
- **Cloud's scope is set by `sonar.exclusions` alone.** SonarCloud's analysis-scope UX
  analyzes the whole project by default and ignores `sonar.sources`, `sonar.tests`
  and `sonar.test.inclusions` — it warns they are "configured but have no effect" —
  so the only lever that still restricts what Cloud measures is `sonar.exclusions`
  in `sonar-project.properties`. The local container keeps honouring those three
  properties, which is why they stay in the file unchanged.
- **The CI scan's `SONAR_TOKEN` is a Cloud token**, not the local container's user
  token from the Install section below. The checked-in properties file carries the
  local project key, so the CI step overrides the identity on the command line
  (`-Dsonar.projectKey=mian17_personal-life`) instead of editing the file.

The receiver is the only long-running piece. It validates the webhook signature,
filters to gate failures on `main` of this project, fetches the new-code issues,
and starts the sandbox agent in a fresh worktree cut from `dev`. The agent then
does the whole job: fix, commit, push, and open the draft PR against `dev`.

## Why the receiver owns the issue list

SonarQube's webhook payload reports only the quality gate, never issues. The agent
could query them through the SonarQube MCP server, but then its scope is whatever
the project carries — on this repo that is the whole backlog. The receiver pins
the list to `inNewCodePeriod=true`, `BLOCKER,CRITICAL,MAJOR,MINOR`, and
`SONAR_AUTOFIX_MAX_ISSUES`, so a run is bounded and the agent cannot wander.
`MINOR` is in because the gate counts every new violation: a new-code set of only
MINOR issues still fails `new_violations > 0`, and dropping them made the loop
log `no-issues` against a red gate.

## The Cloud backlog, rule by rule

Nothing about the backlog in this runbook is remembered. The ledger below is one answer from
the Cloud API, pulled on 2026-11-27 for the project's `dev` branch:

```bash
TOKEN=$(cat ~/.config/sonarcloud.token)
curl -s -H "Authorization: Bearer $TOKEN" \
  'https://sonarcloud.io/api/issues/search?componentKeys=mian17_personal-life&branch=dev&ps=200&statuses=OPEN&resolved=false'
```

The response reports `total: 88` and returns 88 issue objects — nine rules over 28 files.
Those are the open findings on `dev`; a run of this pipeline sees only the new-code subset,
because the receiver pins `inNewCodePeriod=true`.

The table counts the same issues twice, by rule and by file, because neither view answers the
question alone. The rule names the analyser that has to change and the size of the job:
`shell:S7688` is a sweep over six scripts, `docker:S6505` is an install decision repeated eight
times, `javascript:S2871` is one line. The file says where the edit lands and how much of the
rule one file owns — 33 of the 44 `S7688` findings are in `scripts/release.sh`, while `S9382`
puts five findings in one file and one in each of four others. Rule plus file is also the
coordinate every suppression takes: a `sonar.issue.ignore.multicriteria` entry is a rule key
and a resource key, so a verdict recorded at this grain can become an entry, and an entry can
be checked against this table.

| Rule | Type | Open | Findings per file | Verdict |
| --- | --- | --- | --- | --- |
| `shell:S7688` | code smell | 44 | `scripts/release.sh` 33, `scripts/dev-infra.sh` 5, `scripts/setup-dev-env.sh` 2, `scripts/preflight-build.sh` 2, `scripts/ci-compose-env.sh` 1, `scripts/reset-manual-test-data.sh` 1 | Follow-up: `[` → `[[` in every conditional test. |
| `typescript:S9382` | code smell | 16 | `apps/todo-service/src/reminders/reminder.service.ts` 5, `apps/note-service/src/keys/backfill.ts` 3, `apps/app/app/(meals)/meals/entry/[id]/actions.ts` 2, `apps/feedback-service/src/event/dispatcher.service.ts` 2, `apps/idp/scripts/oidc-dance.ts` 1, `apps/meal-service/src/usda/usda.client.ts` 1, `apps/note-service/src/keys/rotation.ts` 1, `packages/service-kit/src/batch/batch-item.ts` 1 | Follow-up: one correctness verdict per site, as `a1`–`a4` did for four others. |
| `docker:S6505` | vulnerability | 8 | `apps/app`, `apps/feedback-service`, `apps/focus-service`, `apps/idp`, `apps/meal-service`, `apps/note-service`, `apps/tags-service`, `apps/todo-service` — `Dockerfile` 1 in each | Follow-up: `--ignore-scripts` changes what the image installs, not just its lint. |
| `docker:S7018` | code smell | 8 | the same eight `Dockerfile`s — 1 in each | Follow-up: sort each apt package list; same pass as `S6505`. |
| `shell:S7679` | code smell | 6 | `scripts/release.sh` 2, `scripts/dev-infra.sh` 2, `scripts/setup-dev-env.sh` 1, `scripts/preflight-build.sh` 1 | Follow-up with `S7688`: bind each positional parameter to a local before testing it. |
| `typescript:S6819` | code smell | 3 | `packages/ui/src/components/feedback-form.tsx` 1, `packages/ui/src/components/tab-bar.tsx` 1, `packages/ui/src/components/theme-toggle.tsx` 1 | Follow-up: a semantic element, or a recorded reason the `group` role is required. |
| `githubactions:S6505` | vulnerability | 1 | `.github/workflows/openwiki-update.yml` 1 | Follow-up with the Dockerfile installs: same rule, same omission. |
| `javascript:S2871` | bug | 1 | `scripts/arch-check.mjs` 1 | Follow-up: pass a comparator; the one finding typed as a bug. |
| `javascript:S1874` | code smell | 1 | `eslint.config.mjs` 1 | Follow-up: drop the deprecated `tseslint.config` signature. |

None of the eighty-eight is silenced, and no group is closed by argument: every row is a
follow-up, an edit nobody has made yet. The silences this repository carries live in
`sonar-project.properties`: the `typescript:S1135` entries and the two analyser-specific
`S1135` entries described below report zero open, and `a1`–`a4` hold four `S9382` sites out of
the count while the rule's other sixteen stay open. That is the distinction the ledger
records: a follow-up is work with no decision on file, a silence is a decision that names its
rule, its file and its reason.

The two shell rules are one pass. `S7679` reports a positional parameter tested inline
("Assign this positional parameter to a local variable") in four of the six scripts `S7688`
touches, and moving a conditional to `[[` rewrites that line anyway, so the shell work is
fifty findings across six files. Fixing it rule by rule would edit the same functions twice.

Both Dockerfile rules are one pass for the same reason. `S6505` is the `npm ci` line in each
of the eight app Dockerfiles, `RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci`,
and `S7018` is the apt list `python3 make g++` eleven lines above it, so one visit per file
settles both. Adding `--ignore-scripts` to that line is not a lint fix: it stops the
lifecycle scripts that build the native dependencies those images install, and the layer cache
mount hangs off the same command. `githubactions:S6505` joins the group as the same omission
in another runner — `.github/workflows/openwiki-update.yml:31` installs a global package
without `--ignore-scripts`.

`typescript:S6819` is the only UI row, and the only one whose fix is a design decision rather
than an edit with one right answer: three components in `packages/ui/src/components` put
`role="group"` on a wrapper, and Cloud suggests a semantic element — `<details>`,
`<fieldset>`, `<optgroup>` or `<address>` — instead. Choosing one changes the element those
wrappers render, so the row needs the review as much as the replacement.

The two JavaScript rows are one file and one line each. `scripts/arch-check.mjs:762` sorts
workflow filenames without a comparator, and Cloud asks for one that compares through
`String.localeCompare`; it is the only finding on this branch typed as a bug.
`eslint.config.mjs:29` calls the deprecated `tseslint.config` signature. Neither needs a
decision recorded anywhere — both need a small edit, which is exactly what this pipeline will
not make, because it fixes new code only.

`typescript:S9382` is the row where the arithmetic is easiest to get wrong: sixteen, not
twelve. Subtracting the four sites `a1`–`a4` cover double-counts them, because the Cloud total
already excludes them. The four suppressed sites are `apps/app/lib/outbox-relay.ts`,
`apps/meal-service/src/meal-todo/meal-todo-producer.service.ts`,
`packages/service-kit/src/outbox/outbox-poller.service.ts` and
`packages/service-kit/src/outbox/outbox.service.ts`, with the per-site reasoning in
`docs/lessons/0031-await-in-loop-is-a-correctness-decision.md`. The sixteen open sites are not
one finding repeated: an `await` in a loop is either a correctness requirement — one intent at
a time so a failing row cannot abort the batch, a cursor advanced only after the broker
confirms — or latency nobody needs, and the verdict is per site. A pattern-wide suppression
would answer the rule without answering the sites, which is why the entries name exact files.

The other correction is about two rules that never appear in the table because they are now at
zero. `githubactions:S1135` at `.github/workflows/compose-boot.yml:7` and `shell:S1135` at
`scripts/ci-compose-env.sh:16` stayed open while entries `t25` and `t26` carried the key
`typescript:S1135`; a `typescript:` key cannot match a finding reported by the `githubactions`
or `shell` analyser, so those entries suppressed nothing. PR #222 re-keyed them to
`githubactions:S1135` and `shell:S1135`, and Cloud now reports zero open for both rules and
exactly those two issues as closed. The rule key in a multicriteria entry must name the
analyser that reports the finding — no resource key, comment or neighbouring entry can make a
`typescript:` entry apply to a workflow or a shell script.

The whole of the backlog is those eighty-eight findings, and this pipeline fixes none of them:
it is bounded to new code. The table exists so the next sweep starts from a measurement
instead of a memory.

## Install

1. Generate a SonarQube **user** token: My Account → Security → Generate Token.
   It needs Browse and See Source Code on `personal-life`.

2. Write the environment file, readable by you only:

   ```bash
   install -m 600 /dev/null ~/.config/sonar-autofix.env
   cat > ~/.config/sonar-autofix.env <<'EOF'
   SONAR_TOKEN=<user token>
   SONAR_WEBHOOK_SECRET=<random 32+ chars, e.g. openssl rand -hex 32>
   SONAR_PROJECT_KEY=personal-life
   SONAR_HOST_URL=http://127.0.0.1:9000
   EOF
   ```

3. Install the unit and start it:

   ```bash
   cp scripts/sonar-autofix/sonar-autofix.service ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user enable --now sonar-autofix
   journalctl --user -u sonar-autofix -f
   ```

   The unit reads `~/.config/sonar-autofix.env`, so a token rotation is a file
   edit plus `systemctl --user restart sonar-autofix`.

4. Register the webhook in SonarQube. It must be a **project** webhook on
   `personal-life`, because that is the only level where the payload carries
   `branch`. Project → Webhooks → Create:

   - URL: `http://host.docker.internal:9100/sonar`
   - Secret: the same value as `SONAR_WEBHOOK_SECRET`

   The SonarQube container reaches the host through `host.docker.internal`; the
   receiver binds `0.0.0.0` for that reason. Nothing else on the LAN can sign a
   request, and unsigned requests are rejected before any work happens.

## Verify without touching the real webhook

```bash
systemctl --user start sonar-autofix            # if not already running
SONAR_AUTOFIX_DRY_RUN=1 systemctl --user restart sonar-autofix
```

Then replay a signed payload. The signature must be computed over the exact bytes
sent, so sign and post in one step:

```bash
SECRET=$(grep '^SONAR_WEBHOOK_SECRET=' ~/.config/sonar-autofix.env | cut -d= -f2-)
BODY='{"taskId":"verify-1","status":"SUCCESS","project":{"key":"personal-life"},"qualityGate":{"status":"ERROR","conditions":[{"metric":"new_reliability_rating","status":"ERROR","value":"2","errorThreshold":"1"}]},"branch":{"isMain":true}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.*= //')
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:9100/sonar \
  -H "X-Sonar-Webhook-HMAC-SHA256: $SIG" -H 'Content-Type: application/json' -d "$BODY"
```

`202` means the payload was accepted. In dry-run mode the log shows `dry-run`
with the issue count and the JSON path; no worktree, no agent, no PR. Read it
with `journalctl --user -u sonar-autofix -n 20`.

An unsigned request returns `401`, a non-`main` branch returns `202` with
`ignored`, and a second webhook while a run is live returns `409`.

## What a real run does

1. `git fetch origin --prune`, then `git pull --ff-only origin dev` when the base
   checkout is on `dev` — a stale base must not seed a branch. A non-fast-forward
   fails the run rather than branching from stale code.
2. A worktree at `.pi/worktrees/sonar-autofix-run` on branch `fix/sonar-<taskId>`
   cut from `dev`, already checked out.
3. The receiver writes the issue list and the PR body to
   `.pi/worktrees/sonar-autofix-handoff/`, then runs
   `pi-sbx --no-session -p --append-system-prompt scripts/sonar-autofix/brief.md`
   naming the branch, the issues file, and the PR body file.
4. Inside the sandbox the agent fixes the issues, runs the owning workspace's
   `typecheck`, commits `fix(sonar): …`, pushes the branch, and runs
   `gh pr create --draft --base dev --body-file <pr body file>`.
5. The receiver checks what the agent delivered and logs
   `{"event":"pull-request","by":"agent","url":"…"}`.

The agent works in its own worktree, on its own branch, and never touches `main` or `dev`.
Nothing is merged.

If the agent commits but does not open the PR, the receiver pushes and creates it
itself and logs `delivery-fallback` first — work is never left stranded on an
unpushed branch. If the agent changes nothing, the run logs `no-changes` and ends.

## Why it cannot loop

The receiver acts only on `branch.isMain` (an absent `branch` counts as main).
A fix lands on `fix/sonar-*`, which no scan covers, so its push cannot trigger
another run. Merging the draft PR into `dev` does trigger the CI-based Cloud scan,
but that scan does not reach this receiver — its webhook is registered on the local
container only — so the next run is still one a person started.

## One caveat about the stored analysis

SonarQube Community Build keeps a single analysis per project, and nothing in CI
scans it: the Cloud analysis is CI-based, the container is only the edit-time gate,
and `.github/workflows/sonarqube.yml` is gone. Full scans of the container are run
by hand, if at all, with `sonar-project.properties` as config and `SONAR_TOKEN`
from the container. Every such scan therefore **replaces** the project's stored
analysis, because the scanner does not set `sonar.branch.name` (Community Build
ignores it).

Consequences:

- The gate-triggered run describes the most recent hand scan of the container,
  which is whichever branch was scanned last by hand — `dev`, if that is the one
  you ran.
- `main` is not scanned in the container unless you scan it. It is the release line
  and receives what `dev` already analysed, so scanning the promotion would only
  duplicate it.
- This pipeline receives webhooks only when a container scan is run by hand; the
  CI-based Cloud analysis on `dev`/`main` is reported on the pull request itself and
  never reaches the receiver.

If you ever need `main` and `dev` measured separately, that is a Developer
Edition feature. Override the target branch with `SONAR_AUTOFIX_BASE_BRANCH` if
the integration branch ever moves.

## Limits

- One run at a time. Overlapping webhooks return `409` and are logged, not
  queued.
- `SONAR_AUTOFIX_TIMEOUT_MS` (default 30 minutes) kills the agent.
- Paths are knobs: `SONAR_AUTOFIX_WORKTREE` (default
  `.pi/worktrees/sonar-autofix-run`) and `SONAR_AUTOFIX_HANDOFF` (default
  `.pi/worktrees/sonar-autofix-handoff`). Both must stay inside the repository —
  the sandbox mounts the repo and sees nothing outside it.
- The agent needs working git authentication inside the sandbox: the repository
  mount plus whatever your sandbox already uses for pushes. If a push fails, the
  run logs the failure and leaves the worktree in place for inspection.
- If the agent leaves no changes, the run logs `no-changes` and opens no PR.
- Fixes are new-code only. Whole-repo backlog is out of scope by design; widen
  `SONAR_AUTOFIX_MAX_ISSUES` and drop `inNewCodePeriod` only if you want that.

## Uninstall

```bash
systemctl --user disable --now sonar-autofix
rm ~/.config/systemd/user/sonar-autofix.service ~/.config/sonar-autofix.env
```

Delete the webhook in SonarQube. Remove `.pi/worktrees/sonar-autofix-run`, `.pi/worktrees/sonar-autofix-handoff`, and
any `fix/sonar-*` branches you no longer want.
