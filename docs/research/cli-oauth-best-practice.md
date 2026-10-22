---

> Specs, intents and task plans cited below were removed from the tree in `d1f54c9`;
> recover any of them with `git show d1f54c9^:<path>`. New work still writes them
> (`docs/intent/<topic>.md`, `SPEC.md`, `docs/specs/SPEC-*.md`).
title: CLI OAuth authorization best practice — delta against @life/ops
status: research (read-only lane output, not a decision)
date: 2026-10-18
sources: RFC 8252, RFC 7636, RFC 9700, RFC 6750, RFC 8707, RFC 9728, RFC 8628,
         draft-ietf-oauth-v2-1-14 (datatracker.ietf.org)
evidence: every claim carries an RFC NNNN §X.Y citation
---

# CLI Authentication / Authorization — Best Practice vs `@life/ops`

Scope: `packages/ops/src/auth/{login,refresh,token-store}.ts`, `packages/ops/src/transport/{executor,errors}.ts`,
`SPEC.md` §2.5/§2.6/§10.3–§10.5, plus the IdP side that decides whether the CLI can actually log in
(`apps/idp/src/oidc/{clients,oidc.service,refresh-token.policy,access-token.policy}.ts`) and
`node_modules/oidc-provider@9.12.2` behaviour.

Verdict up front: the **client** is close to textbook — authorization code + PKCE S256, external
browser, ephemeral loopback port on `127.0.0.1`, high-entropy `state`, atomic 0600 store, rotation on
refresh. Three things are wrong: (1) the **`dev` client is registered as `application_type: web` with
fixed ports**, so a real-port login is rejected — RFC 8252 §7.3 violation, only masked by the stub
IdP; (2) **`expiresAt` and `refresh` are never used by the request path**, so every 10-minute expiry
is a hard "log in again"; (3) **rotation drops the refresh token when the IdP omits one** (RFC 6749 §6).

---

## 1. Required flow (what a CLI must do)

| Practice | Source | Status in our code |
|---|---|---|
| Authorization Code, never implicit, never ROPC | RFC 9700 §2.1.1, §2.1.2 | OK — `login.ts:141` `response_type=code` |
| Run the authorization request in the **user's external browser**; embedded webviews forbidden | RFC 8252 §4, §8.12 ("MUST NOT use embedded user-agents") | OK — `login.ts:284-291` (`open`/`start`/`xdg-open`), no webview |
| Loopback redirect `http://127.0.0.1:{port}/{path}`, **any port accepted by the AS** | RFC 8252 §7.3; RFC 9700 §2.1 ("exact redirect matching except loopback port") | **BROKEN** — see §6 |
| Register as a **public client** (no secret) | RFC 8252 §8.4, §8.5 ("MUST treat client as public") | OK — `clients.ts:96` `token_endpoint_auth_method: 'none'` |
| `state` with high entropy, checked on the response | RFC 8252 §8.9 | OK — `login.ts:131` 16 random bytes, `login.ts:169-171` exact compare |
| `redirect_uri` re-verified against the one sent | RFC 8252 §8.10 | OK effectively — the listener port is bound before the request, `login.ts:233-246` |
| Bind loopback only, open the socket only for the duration of the flow, close after | RFC 8252 §8.3 | OK — `server.listen(0,'127.0.0.1')`, `finally listener.server.close()` (`login.ts:120-122`) |
| Prefer the IP literal over `localhost` | RFC 8252 §8.3 ("use of localhost is NOT RECOMMENDED") | OK — `login.ts:158` uses `127.0.0.1` |
| Use PKCE unconditionally; AS must enforce it | RFC 9700 §2.1.1; RPC draft-oauth-v2-1 §4.1.1; RFC 8252 §8.1 | OK client side; OK server side (`oidc.service.ts:99` `pkce:{required:()=>true}`) |
| Send `resource` (RFC 8707) so the token is audience-scoped | RFC 8707 §2; MCP authorization spec | OK in intent, non-conformant in value — see §6 |
| Don't send tokens to the browser/stdout | RFC 9700 §4.14 (leak) ; RFC 6750 §5.3 | OK — `login.ts:1-9` contract; enforced by `test/auth.test.ts:59-75` |
| On 401 with `invalid_token`, MAY obtain a new token and retry | RFC 6750 §3.1 | **Missing** — see §3 |
| Handle authorization-error responses (`?error=access_denied`) | RFC 6749 §4.1.2.1 | Weak — `login.ts:255-262` reports only "no code", discarding `error`/`error_description` |

## 2. PKCE specifics

| Practice | Source | Status |
|---|---|---|
| Verifier = 43–128 unreserved chars from ≥32 random octets; base64url(32 bytes)=43 chars | RFC 7636 §4.1, §7.1 | OK — `login.ts:127-129` `randomBytes(32).toString('base64url')` (43 chars, all unreserved) |
| `code_challenge_method=S256` mandatory when capable; `plain` only as fallback | RFC 7636 §4.2; RFC 9700 §2.1.1 ("S256 is the only method") | OK — `login.ts:151-152`, `createHash('sha256')` at `login.ts:153-155`; `plain` never offered |
| One verifier per authorization request, not reused | RFC 9700 §2.1.1 ("challenge MUST be transaction-specific") | OK — `beginLogin()` per call, `login.ts:123-125` |
| Never downgrade: token request with `code_verifier` only valid if a challenge was sent | RFC 9700 §4.8.2 | Client is not the risk here; the AS enforces `pkce.required` |
| Verifier only lives in process memory until the token request | RFC 7636 §4.1 | OK — `PendingLogin`, never persisted, never logged |

## 3. Refresh handling

| Practice | Source | Status |
|---|---|---|
| AS must detect replay for public clients; rotation or sender-constrained tokens | RFC 9700 §4.14.2 | OK server side — `refresh-token.policy.ts:33` `ROTATE_REFRESH_TOKEN = true`, family revocation documented `refresh-token.policy.ts:26-30` |
| On rotation the client MUST discard the old refresh token | RFC 6749 §6 | OK — `refresh.ts:51-57` overwrites the store (atomic) |
| If the AS issues **no** new refresh token, the old one stays valid — do not drop it | RFC 6749 §6 ("if a new refresh token is issued… discard the old") | **BUG** — `refresh.ts:53` `refreshToken: reply.refresh_token` writes `undefined`; the next call forces a full re-login. Latent today (rotation always returns one) |
| Refresh before expiry, not only after failure | RFC 6749 §6; RFC 6750 §3.1 | **Missing** — `expiresAt` is written (`login.ts:213`, `refresh.ts:54`) and validated (`token-store.ts:93`) but **read by nobody**; `refresh` is exported (`index.ts:35`) and called only from `test/auth.test.ts` |
| 401 → refresh once → retry the same request | RFC 6750 §3.1 | **Missing** — `executor.ts:76-78` throws on the first non-ok response; `codeForStatus` (`errors.ts:81-86`) flattens every 401 to `unauthenticated` and `detailFromBody` discards `WWW-Authenticate` |
| Distinguish "expired token" from "no token" in the message | RFC 6750 §3.1 (`error="invalid_token"`) vs §3 (no error code) | **Missing** — one message for both (`errors.ts:54-60`); users cannot tell `login` from a retry |
| Rotation must be serialized per credential | RFC 9700 §4.14.2 (reuse detection revokes the family) | Risk — no lock/CAS on the store; two concurrent `life-ops` calls, or CLI + MCP together, can present the same token and get the whole grant family revoked. Fine while single-process/single-user; name the assumption |
| Do not treat every failure as "re-login required" | — | Weak — `refresh.ts:66-68` returns `undefined` on any non-ok response, so a 500 or a dead IdP is indistinguishable from a revoked token |

## 4. Token storage

| Practice | Source | Status |
|---|---|---|
| Native clients cannot keep secrets; protect tokens with OS file permissions, not encryption | RFC 8252 §8.5, §8.1 | OK and correctly reasoned — no at-rest crypto pretending to add security |
| Store at `0600` inside a `0700` directory | general practice; RFC 8252 §8.1 | OK — `token-store.ts:24-25`, `46-53`; `chmod` after `writeFile` is the right fix for umask; asserted in `test/auth.test.ts:53-57` |
| Atomic replace so a reader never sees a torn file | — | OK — scratch `${path}.${pid}.tmp` + `rename`, `token-store.ts:50-53` |
| Honour `XDG_CONFIG_HOME` rather than hardcoding `~/.config` | XDG Base Directory spec | OK — `token-store.ts:61-64` (SPEC §10.4 is already answered by the code) |
| Malformed/unreadable store = "no credentials", never a crash | — | OK — `token-store.ts:83-94` |
| Never log tokens; not in argv; not in the URL | RFC 6750 §5.3 | OK — token never enters the URL (`login.ts:158`, `executor.ts:115` header only) |
| Don't tighten an existing directory's mode silently | — | Minor gap — `mkdir(…,{mode:0o700})` only applies at creation; a pre-existing `0755` `~/.config/life-ops` stays `0755` |
| Logout is idempotent and local | — | OK — `token-store.ts:56-59`. Note: local-only; it does not revoke server-side (RFC 7009 is disabled on this IdP, `oidc.service.ts` `revocation: {enabled:false}`) |

## 5. Headless / SSH

| Practice | Source | Status |
|---|---|---|
| Loopback flow works on a remote host only with port forwarding (`ssh -L`) | RFC 8252 §7.3, §8.3 (flow assumes a browser on the same device) | Undocumented. `openBrowser` failing falls back to printing the URL (`login.ts:161-167`) but the URL points at `127.0.0.1:<port>` on the **remote** box — useless without `ssh -L <port>:127.0.0.1:<port>` |
| Devices with limited input / no browser should use the Device Authorization Grant | RFC 8628 §1, §3 | Not available — `oidc.service.ts` `deviceFlow: {enabled: false}`; SPEC §2.5 records this correctly. Device flow is the *correct* answer for SSH; documenting `ssh -L` is the honest interim |
| User-code entropy + rate limiting if device flow ever lands | RFC 8628 §5.1, §6.1 | n/a today; record it when `deviceFlow` is enabled |
| A login that cannot complete must fail, not hang | — | **Missing** — `waitForCallback` (`login.ts:248-265`) has no timeout; closing the browser tab hangs `life-ops login` until Ctrl-C |
| Never drive an out-of-band flow from inside an MCP stdio server | MCP authorization spec ("implementations using STDIO SHOULD NOT follow this specification, retrieve credentials from the environment") | OK — MCP reads the store and errors with `run life-ops login` (`mcp/server.ts:11,37`). SPEC §10.5 (add an `auth_login` tool) should stay closed: it would make the server own a browser + loopback listener |

## 6. Client identity (the one thing that is actually broken)

`apps/idp/src/oidc/clients.ts:11` registers `dev` with **fixed** redirect URIs
`http://127.0.0.1:8080/cb` and `http://localhost:8080/cb`, and **never sets `application_type`**.
`oidc-provider` defaults it to `web` (`lib/consts/client_attributes.js:31`). Its redirect matcher
(`lib/models/client.js:486-505`):

```js
#redirectAllowed(value, allowedUris) {
  if (allowedUris.includes(value)) return true;
  if (this.applicationType !== 'native') return false;   // ← `dev` lands here
  const withoutPort = stripLoopbackPort(value); …        // port-insensitive only for native
}
```

Consequences:

1. **Port**: the CLI binds an ephemeral port (`login.ts:239` `server.listen(0,'127.0.0.1')`), so the
   redirect is `http://127.0.0.1:<random>/callback`. Not in `allowedUris`, `applicationType !== 'native'`
   → hard `false`. RFC 8252 §7.3: "the authorization server MUST allow any port to be specified at the
   time of the request for loopback IP redirect URIs". We violate the MUST.
2. **Path**: even as `native`, port-stripping compares the whole URI, so `/callback` (`login.ts:50`)
   would still not match the registered `/cb`.
3. **Client type not recorded**: RFC 8252 §8.4 — "Authorization servers MUST record client type in
   client registration details" and native apps "MUST be registered with the authorization server as such".
   A `token_endpoint_auth_method: 'none'` client left as `web` is exactly the mis-registration that section forbids.

Why nobody noticed: the test IdP (`test/support/stub-idp.ts:148`) accepts **any**
`http://127.0.0.1:*` redirect, and `test/auth.test.ts` only ever talks to it. Against the real IdP the
first `life-ops login` fails with `invalid_redirect_uri`.

Secondary identity issues:

- **Shared `dev` client** (SPEC §2.6 / §10.3). RFC 8252 §8.10 wants a unique redirect URI per AS per
  client; more practically, sharing one client id across tests, scripts and the CLI means one grant
  family, one consent, and revoking one consumer revokes all (RFC 9700 §4.14.2). A dedicated `cli`
  client is not a nicety — it is the fix for the port bug above, because only that registration can
  carry `application_type: 'native'`.
- **`resource=life-api` is not an absolute URI.** RFC 8707 §2: "Its value MUST be an absolute URI …
  MUST NOT include a fragment". `login.ts:67` sends the bare string `life-api`. It works only because
  `audienceFor` (`access-token.policy.ts:50-59`) fails `new URL('life-api')` and falls back to the raw
  value, which happens to equal the ecosystem audience decided in `SPEC-service-kernel.md:81-96`.
  The RFC-conformant spelling is `https://life-api` (+ an `OIDC_AUDIENCE_MAP` entry), which also stops
  the value from silently depending on a catch-block. Same value must be sent on refresh
  (`refresh.ts:75-81` sends it — good, RFC 8707 §2.2).

## 7. Delta table

| # | Practice | Source | Our file:line | Verdict |
|---|---|---|---|---|
| 1 | AS must accept any loopback port | RFC 8252 §7.3 | `clients.ts:11,92-98` (no `application_type`) + `login.ts:239` (ephemeral port) | **Fail** (real IdP rejects) |
| 2 | Native client registered as native | RFC 8252 §8.4 | `clients.ts:92-98` defaults to `web` | **Fail** |
| 3 | Redirect URI path must match | RFC 8252 §8.4 | `login.ts:50` `/callback` vs `clients.ts:11` `/cb` | **Fail** |
| 4 | Refresh path reachable from the request flow | RFC 6750 §3.1, RFC 6749 §6 | `executor.ts:76-78`; `index.ts:35` (export only) | **Fail** |
| 5 | `expiresAt` drives refresh | — | `token-store.ts:21`, `login.ts:213`, `refresh.ts:54` — never read | **Fail** (dead field) |
| 6 | Keep the old refresh token if none is re-issued | RFC 6749 §6 | `refresh.ts:53` | **Fail** (latent) |
| 7 | Parse `WWW-Authenticate` / `invalid_token` | RFC 6750 §3, §3.1 | `errors.ts:81-86`, `errors.ts:54-60` | **Fail** (low severity) |
| 8 | `resource` must be an absolute URI | RFC 8707 §2 | `login.ts:67` (`life-api`) | **Fail** (non-conformant, functional) |
| 9 | Loopback flow is not SSH-friendly; document forwarding | RFC 8252 §8.3, RFC 8628 §1 | no doc, `login.ts:161-167` | **Fail** (docs) |
| 10 | Login must not hang | — | `login.ts:248-265` (no timeout) | **Fail** (low) |
| 11 | Auth code + PKCE S256 only | RFC 9700 §2.1.1 | `login.ts:141,151-155` | Pass |
| 12 | Verifier 43–128 unreserved, ≥32 random octets | RFC 7636 §4.1, §7.1 | `login.ts:127-129` (43 chars) | Pass |
| 13 | Per-transaction challenge/state | RFC 9700 §2.1.1, RFC 8252 §8.9 | `login.ts:123-125,131` | Pass |
| 14 | External browser, never embedded | RFC 8252 §4, §8.12 | `login.ts:284-291` | Pass |
| 15 | Loopback IP literal, not `localhost` | RFC 8252 §8.3 | `login.ts:158` | Pass |
| 16 | Listener bound to loopback, closed after | RFC 8252 §8.3 | `login.ts:239`, `login.ts:119-122` | Pass |
| 17 | Public client, no secret | RFC 8252 §8.4, §8.5 | `clients.ts:96` | Pass |
| 18 | Store 0600 in 0700, atomic | — | `token-store.ts:24-25,46-53` | Pass |
| 19 | `XDG_CONFIG_HOME` honoured | XDG spec | `token-store.ts:61-64` | Pass |
| 20 | Malformed store = no credentials | — | `token-store.ts:83-94` | Pass |
| 21 | Rotate + discard old refresh token | RFC 6749 §6, RFC 9700 §4.14.2 | `refresh.ts:51-57`, `refresh-token.policy.ts:33` | Pass |
| 22 | No token in stdout/URL/logs | RFC 6750 §5.3 | `login.ts` contract + `test/auth.test.ts:59-75` | Pass |
| 23 | Stdio MCP reads credentials, no OAuth dance | MCP auth spec | `mcp/server.ts:11,37` | Pass |

## 8. Ranked fixes

1. **Register a `cli` client as `application_type: 'native'`** with redirect `http://127.0.0.1/callback`
   (and `/callback` under `localhost` if you keep the alias). Without this, `life-ops login` cannot
   work against the real IdP. Touches `apps/idp` — so it is not a deferrable open question; SPEC §10.3
   must be answered "yes, do it now". If `apps/idp` really is frozen, the alternative is a documented
   `LIFE_OPS_REDIRECT_PORT=8080` pin, which only works while the port is free and then *still* needs
   `/cb` — i.e. also an IdP edit. There is no client-only fix.
2. **Wire refresh into the request path**: on 401 → `refresh()` → retry the same request once
   (`executor.ts:73-79`), and pre-emptively refresh when `expiresAt` is within a small skew. Otherwise
   the 10-minute access token (`access-token.policy.ts:5`) makes every session a re-login and the whole
   refresh subsystem is dead code. Keep the retry single-shot so a revoked family does not loop.
3. **Fix the rotation drop**: `refresh.ts:53` — `refreshToken: reply.refresh_token ?? heldRefreshToken`,
   per RFC 6749 §6. Add the auth-suite case where the stub returns no `refresh_token`.
4. **Make 401 legible**: return `error="invalid_token"` vs bare 401 as distinct detail text
   (`errors.ts:81-86`, `errors.ts:54-60`) so "expired, retrying" is distinguishable from "run login".
   The stub API should send `WWW-Authenticate` so the test has something to assert.
5. **Send an absolute `resource`**: `https://life-api` + `OIDC_AUDIENCE_MAP` entry, or record the
   deviation in `SPEC.md` §2.5. RFC 8707 §2 says MUST.
6. **Give `waitForCallback` a timeout** (e.g. 5 min) that closes the listener and exits non-zero — a
   login that cannot finish must not hang the tool.
7. **Document SSH**: `ssh -L <port>:127.0.0.1:<port>` alongside the printed URL, or accept that SSH
   login is unsupported until `deviceFlow` is enabled (RFC 8628).
8. **Tighten store mode** if the directory pre-exists: `chmod(dir, 0o700)` after `mkdir`.
9. **Surface `error=`/`error_description=`** from the authorization response instead of the generic
   "authorization server returned no code".

## 9. Where the design is already right (don't "fix" these)

- Client-side, this is the shape RFC 8252 recommends for desktop CLIs: code + PKCE, external browser,
  ephemeral loopback port on the IP literal, `state` compared exactly.
- No secret shipped in the CLI (`token_endpoint_auth_method: 'none'`) — RFC 8252 §8.5 explicitly says a
  distributed secret is not a secret; the code does not pretend otherwise.
- 0600 file + 0700 dir + atomic rename + XDG is the correct answer; at-rest encryption would add
  ceremony without adding a protection boundary (the process can decrypt anyway).
- Rotation-on-use with family revocation (`refresh-token.policy.ts`) is the RFC 9700 §4.14.2
  recommendation implemented exactly, and the client discards the old token as RFC 6749 §6 requires.
- Refusing to add an `auth_login` MCP tool (SPEC §10.5) is correct: the MCP stdio spec says stdio
  clients take credentials from the environment, not from an OAuth dance inside the server.
- SPEC §10.4 (XDG vs `~/.config`) is already resolved in code — close it in the spec so it stops
  reading as an open question.
