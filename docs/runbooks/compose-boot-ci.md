# Runbook — compose-boot CI

`.github/workflows/compose-boot.yml` builds the eight images and boots the whole
`compose.yaml` stack, then fails unless every service reports healthy and every
backend answers its own `/health/ready`.

## What it proves

It exercises **the deployed artifact**, not the source. Every other workflow runs
tests against TypeScript; this one runs containers. That gap is what let three
features ship dead in production on 2026-11-14 with a green test run:

| What was missing | How it showed in production | Could a static check catch it? |
|---|---|---|
| `MEAL_TODOS_API_URL` | meals Todos toggle 503, outbox poller never delivered | yes — the name is literal |
| `FOCUS_TODOS_API_URL` | task-linked focus session 503 | yes — idem |
| `OIDC_PRODUCER_*` | IdP refused to boot under `NODE_ENV=production` | **no** — see below |

The IdP composes the setting name at runtime:

```ts
// apps/idp/src/oidc/clients.ts
const setting = `OIDC_PRODUCER_${producerName.toUpperCase().replaceAll('-', '_')}_REDIRECT_URIS`;
```

No grep, type check or lint sees a missing value there. A boot crash is only
visible by booting, and this job is the only place in CI that boots.

## What the app assertions prove

The `Assert the host-published endpoints` step makes three assertions against
`http://127.0.0.1:3002`, and together they separate the two gates that
`apps/app/lib/auth/gate.ts` runs in order.

| Request | Want | What it proves |
|---|---|---|
| `GET /`, no headers | **403** | ACCESS arms and fails closed. Compose sets `NODE_ENV=production`, Next sets `x-forwarded-host`, and the gate demands a `tailscale-user-login` matching `OWNER_LOGIN`; a CI curl sends none, so it returns `forbidden` (`gate.ts:66`, `gate.ts:69-70`). A 200 here would be the security failure. |
| `GET /`, `x-forwarded-host: localhost`, `tailscale-user-login: <OWNER_LOGIN>` | **307** | ACCESS admits the owner, and IDENTITY redirects an unauthenticated visitor: the path is not public and there is no session cookie, so the gate answers `redirect-login` (`gate.ts:76-77`) and the app sends the browser to `/auth/login`. |
| `GET /icon.svg`, the same two headers | **200** | Both gates are genuinely evaluated and both say yes. `/icon.svg` is in `PUBLIC_EXACT` (`gate.ts:33`), so IDENTITY returns `next` with no session, and the file exists in `apps/app/public/`, so the static handler serves it. 307 on `/` **plus** 200 here is the pair that reads as "access granted, identity required". |

Which public path is used for the third assertion is not arbitrary. The proxy's matcher
(`apps/app/proxy.ts:66`) excludes `favicon.ico` and `_next/*` before `decideGate` runs at
all, so a path it excludes would answer without either gate deciding — a green result
that proves nothing. That is why the assertion uses `/icon.svg` and not the favicon, and
why `gate.ts`'s own `PUBLIC_EXACT` entry for `/favicon.ico` is dead for the proxy while
remaining live for the unit suite (`apps/app/test/gate.test.ts:143`) — the unit test
therefore cannot catch that trap.

`OWNER_LOGIN` is written by `scripts/ci-compose-env.sh` as a throwaway CI fixture
(`ci-compose-boot@example.com`) and reaches the container through the `env_file: .env`
every service already declares, which `apps/app/proxy.ts:42` reads into the gate. No
compose change was needed. The step reads the value back out of that generated file
instead of duplicating the literal, so fixture and assertion cannot drift.

A 403 on the second assertion does not mean identity is broken — it means
`OWNER_LOGIN` did not reach the container, so ACCESS never had an owner to match. The
comment above that assertion says so, because that is the half that would break after
a fixture edit.

All three are inert GETs: no session cookie is sent, no state is written, nothing is
POSTed and the IdP is never asked for a token.

## What is still not proven

A **completed interactive login** is not exercised: no token exchange with the IdP, no
session cookie written, no authenticated page served. Proving that needs a real browser
or a scripted PKCE flow against the running IdP, which is out of scope for a job whose
purpose is to boot the deployed shape and check its gates answer correctly. So this job
proves the gates' *decisions*, not the sign-in journey.

## Cost

6–10 minutes: eight image builds plus a full-stack `up --wait`. The concurrency
group cancels a superseded run (`cancel-in-progress: true`) and the job has
`timeout-minutes: 25`, so a hung build cannot run long. The alternative is
discovering the same defect after a release — which is what happened.

## What it deliberately composes

The production shape, not a dev-ish approximation. Compose sets
`NODE_ENV=production` on all eight built services, so the IdP and the app enforce
their production-only requirements (a real `OIDC_APP_CLIENT_SECRET`, a registered
callback per producer client). A boot check that ran with dev defaults would
reproduce none of the failures it exists to catch.

The env file it uses is generated by `scripts/ci-compose-env.sh`, which writes
`<repo>/.env` (gitignored, and the only path compose accepts — `compose.yaml`
pins `env_file: .env`) with throwaway values for every variable the stack is
required to have **at boot**. That is a wider set than interpolation requires:
`docker compose config` succeeds on a variable compose forwards with an empty
default, and the service then dies on it. Those variables are listed with their
reasons in the script's header.

## Prerequisites — the six bind-mount directories

`compose.yaml` bind-mounts six host directories for the SQLite files:
`./apps/{note,tags,todo,meal,focus}-service/data` and `./apps/idp/data`. `data/` is
gitignored (`.gitignore:5`), so **a fresh checkout has none of them**. Docker creates a
missing bind source as **root**, and every image runs as `USER node` (uid 1000), so the
service then cannot create its database and dies with
`SqliteError: unable to open database file`. The job therefore creates all six and
chowns them to `1000:1000` in a step before booting — the same prerequisite
`docs/runbooks/production-deploy.md` already lists for a human deploy, because a CI
checkout is just another fresh machine. `Tear down` removes containers and named
volumes but not these host directories, which is why the step also chowns: a rerun on
the same runner would otherwise inherit root-owned leftovers from the failed attempt.

## Running the same sequence locally

From the repo root, with a real `.env` already in place (the generator refuses to
overwrite one — that guard is what keeps it from clobbering your host secrets):

```bash
# 1. Interpolation only, about a second, no build.
docker compose config >/dev/null && echo config-ok

# 2. Build the eight images.
docker compose build

# 3. Boot and block until healthy; exits non-zero if any service does not get there.
docker compose up -d --wait --wait-timeout 300

# 4. Readiness from INSIDE each container — proves service-to-service reachability,
#    which a host curl cannot show.
for s in note-service:3001 tags-service:3004 todo-service:3005 \
         feedback-service:3008 meal-service:3106 focus-service:3107 idp:3003; do
  n=${s%%:*}; p=${s##*:}; printf '%-18s ' "$n"
  docker compose exec -T "$n" node -e \
    "fetch('http://127.0.0.1:$p/health/ready').then(r=>console.log(r.status)).catch(()=>console.log('fail'))"
done

# 5. Host-published endpoints, all three app gates. The first curl's correct answer is
#    403, not 200: compose sets NODE_ENV=production, Next sets `x-forwarded-host`, and
#    the ACCESS gate (apps/app/lib/auth/gate.ts:66) refuses traffic with no
#    `tailscale-user-login` — fail-closed. The next two replay what Tailscale Serve would
#    forward, using the OWNER_LOGIN your .env declares: 307 on `/` is IDENTITY asking for
#    a login, 200 on /icon.svg (a public path, and not one the proxy matcher skips) is
#    both gates letting it through. An openly-200 `/` would be the security failure this
#    check catches.
curl -s -o /dev/null -w 'app %{http_code}\n' http://127.0.0.1:3002/    # want 403
curl -s -o /dev/null -w 'idp %{http_code}\n' http://127.0.0.1:3003/health/ready  # want 200
owner=$(sed -n 's/^OWNER_LOGIN=//p' .env)
curl -s -o /dev/null -w 'app %{http_code}\n' http://127.0.0.1:3002/ \
  -H 'x-forwarded-host: localhost' -H "tailscale-user-login: $owner"          # want 307
curl -s -o /dev/null -w 'app %{http_code}\n' http://127.0.0.1:3002/icon.svg \
  -H 'x-forwarded-host: localhost' -H "tailscale-user-login: $owner"          # want 200

# 6. Teardown. -v removes the throwaway volumes.
docker compose down -v --remove-orphans
```

On a machine where you want to reproduce CI's own values instead of your host's,
delete `.env` first (back it up), run `scripts/ci-compose-env.sh`, and restore it
after. Do not copy a generated CI env file to a real deployment: its master keys
are throwaway, and using it against existing data would make every encrypted row
undecryptable.

## When it goes red

The job prints `docker compose ps`, each container's `docker inspect` health status and
the last 200 log lines of every service on failure. Read the health column first:
`unhealthy` (a healthcheck failing) and `exited` (a boot crash) have different
causes. A log line naming `… is required` means the fixture is wrong, not the
deployment; a stack trace means the deployment is wrong.

### First real finding (2026-11-14, run 43600971651, head e483cd4)

On its first real run the job failed where nothing else in CI had: step 8
"Boot the stack and wait for health" went red, `focus-service` and `idp` logged
`SqliteError: unable to open database file`, and compose reported
`dependency failed to start: container personal-life-meal-service-1 is unhealthy`.
That is the six missing bind-mount directories above — invisible to tests, lint and
`docker compose config`. The `Dump diagnostics` step is what named it: it ran on the
failure path and printed the service logs, so the cause was read straight out of the
job instead of guessed from a red X. The fix is the directory-preparation step, and
the job proved its own value on day one by catching a defect no static check could.
