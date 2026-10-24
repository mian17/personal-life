# SonarQube auto-fix

SonarQube webhook → host receiver → pi-sbx sandbox agent → draft pull request.

The receiver is the only long-running piece. It validates the webhook signature,
filters to gate failures on `main` of this project, fetches the new-code issues,
and starts the sandbox agent in a fresh worktree. The agent then does the whole
job: fix, commit, push, and open the draft PR.

## Why the receiver owns the issue list

SonarQube's webhook payload reports only the quality gate, never issues. The agent
could query them through the SonarQube MCP server, but then its scope is whatever
the project carries — on this repo that is the whole backlog. The receiver pins
the list to `inNewCodePeriod=true`, `BLOCKER,CRITICAL,MAJOR`, and
`SONAR_AUTOFIX_MAX_ISSUES`, so a run is bounded and the agent cannot wander.

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

1. `git fetch origin dev`, then a worktree at `~/.cache/sonar-autofix/worktree` on
   branch `fix/sonar-<taskId>` cut from `dev`, already checked out.
2. The receiver writes the issue list and the PR body to
   `~/.local/state/sonar-autofix/`, then runs
   `pi-sbx --no-session -p --append-system-prompt scripts/sonar-autofix/brief.md`
   naming the branch, the issues file, and the PR body file.
3. Inside the sandbox the agent fixes the issues, runs the owning workspace's
   `typecheck`, commits `fix(sonar): …`, pushes the branch, and runs
   `gh pr create --draft --base dev`.
4. The receiver checks what the agent delivered and logs
   `{"event":"pull-request","by":"agent","url":"…"}`.

The agent works in its own worktree, on its own branch, and never touches `main` or `dev`.
Nothing is merged.

If the agent commits but does not open the PR, the receiver pushes and creates it
itself and logs `delivery-fallback` first — work is never left stranded on an
unpushed branch. If the agent changes nothing, the run logs `no-changes` and ends.

## Why it cannot loop

The receiver acts only on gate failures where `branch.isMain` is true. A fix
lands on `fix/sonar-*`, so its analysis never satisfies that filter.

## One caveat about `dev`

SonarQube Community Build analyses a single branch per project, and
`.github/workflows/sonarqube.yml` only runs on `main`. So the gate failure that
triggers a run is always a `main` failure, while the fix and its PR target `dev`.
That is deliberate: `dev` is where work accumulates before `main`, and analysing a
second branch would need a commercial edition. Keep this in mind when `dev`
diverges from `main` — a `dev`-only issue never triggers a run.

Override the target with `SONAR_AUTOFIX_BASE_BRANCH` if the integration branch
ever moves.

## Limits

- One run at a time. Overlapping webhooks return `409` and are logged, not
  queued.
- `SONAR_AUTOFIX_TIMEOUT_MS` (default 30 minutes) kills the agent.
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

Delete the webhook in SonarQube. Remove `~/.cache/sonar-autofix/worktree` and any
`fix/sonar-*` branches you no longer want.
