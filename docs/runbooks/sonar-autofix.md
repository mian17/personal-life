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
