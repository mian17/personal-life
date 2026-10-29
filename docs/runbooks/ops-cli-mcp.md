# `@life/ops` — CLI and MCP server

`life-ops` is one CLI and one MCP stdio server over the same operation registry: each
`notes_*` tool and each `notes <op>` command is one call rendered twice. Both read the
one credential store `life-ops login` writes; neither opens a browser except `login`.

## Run the CLI by hand

`packages/ops/package.json` publishes the bin as `life-ops` → `dist/cli/run.js`; the dev
env file carries its ops block (`LIFE_OPS_*` plus `IDP_ISSUER`) — read that block in
`scripts/setup-dev-env.sh`, whose IdP port is the one `login` dials.

```bash
bash scripts/setup-dev-env.sh        # writes .env.development, never clobbers
npm run build -w @life/ops
OPS="node --env-file-if-exists=.env.development packages/ops/dist/cli/run.js"
$OPS login
$OPS notes list --limit 5
```

`login` is the one prerequisite: it drives the IdP in a browser and writes
`~/.config/life-ops/credentials.json` (`0600`, `LIFE_OPS_CREDENTIALS_PATH` overrides).
Shape is `life-ops <resource> <op> [flags]`, flags in kebab case (`--expected-version`):

```bash
$OPS notes create --body "runbook check"
$OPS notes list --limit 5
$OPS notes get --id <id>
$OPS notes update --id <id> --body "edited" --expected-version 0
$OPS notes delete --id <id>
$OPS notes restore --id <id>
```

Reusing a moved version exits 1 with `notes.update failed (conflict): Note was
modified`; codes: `invalidInput`, `unauthenticated`, `notFound`, `requestFailed`, `timeout`.

## Drive it over MCP

Same registry on stdio, but the server never logs in: run `life-ops login` once first.
`args` needs the absolute path to `dist/mcp/server.js`; the env values below are dev's:

```json
{"mcpServers":{"life-ops":{"command":"node","args":["<repo>/packages/ops/dist/mcp/server.js"],
 "env":{"LIFE_OPS_SERVICE":"notes","LIFE_OPS_API_BASE":"http://127.0.0.1:3101","LIFE_OPS_CLIENT_ID":"dev",
        "LIFE_OPS_RESOURCE":"https://note-service","IDP_ISSUER":"http://127.0.0.1:3102"}}}}
```

Six tools: `notes_create`, `notes_get`, `notes_list`, `notes_update`, `notes_delete`,
`notes_restore`. A missing store is a tool result, not a crash — `notes.list failed
(unauthenticated): no token found, run \`life-ops login\` first`, `isError: true`, exit 0.
Refresh is the server's job: a call near or past expiry refreshes inside the live
process, so one login outlives one access token.

## Two traps worth knowing

**A dev-mode service proves nothing about auth.** `packages/service-kit/src/auth/auth.guard.ts`
returns early when `NODE_ENV === 'development'` and sets principal `dev-user` without
reading the token, so a bogus token and an absent one both answer `200`; restart with
`NODE_ENV=test` for real `401`s. The comment claims "for localhost" but checks `NODE_ENV`.

**The login callback is pinned to 8080 at `/cb`.** The seeded dev client registers only
those redirect URIs, so busy 8080 must be freed, not routed around — any other port
returns `invalid_redirect_uri`, and the CLI names the port instead of falling back.

## What to check when it does not work

- `no token found, run \`life-ops login\` first` → run `life-ops login`.
- `invalid_redirect_uri` → 8080 is not free, or the IdP redirect list changed.
- `notes_list` rejects a token the CLI accepted → service is in development mode.
