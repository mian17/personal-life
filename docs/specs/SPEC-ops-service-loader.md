# SPEC-ops-service-loader — module id `ops-service-loader`, body extracted verbatim from the frozen capability map `docs/specs/SPEC-ops-all-services.md` §1.1.2

#### 1.1.2 `ops-service-loader` — the loading contract (E1, E3)

- **E1 — multi-resource service modules.** `ServiceModule`
  (`packages/ops/src/cli/run.ts:22-26`) gains `resources?: ResourceRegistry[]`
  beside the existing `registry`. Exactly one of the two must be present; the
  loader errors on both or neither (existing error style). The loaded union is
  `resources ?? [registry]`. `ResourceRegistry = ResourceSpec`
  (`core/types.ts:40`) is unchanged — the win comes from several resources per
  module, each with its own `basePath`, which is exactly what the audit's rank-1b
  unblocks. Tool names `<resource>_<kind>` (`core/schema.ts:61` already derives
  them from resource names) must be unique across the union; the loader asserts
  it and errors on collision naming both resources. `notes` and
  `fixtures/sample.ts` compile unchanged — a regression guard, not a rewrite.

- **E3 — comma-separated loading and per-service bases.** `LIFE_OPS_SERVICE`
  accepts a comma-separated list (whitespace trimmed); each entry resolves as
  today (bare name → the in-package `src/services/<name>`, path-like → a module
  exporting `service`/`registry`). The union of all loaded registries feeds both
  adapters (names unique per E1). Per-call base resolution, in precedence order:
  the module's own `apiBase` (none of these modules sets one) →
  `LIFE_OPS_API_BASE_<NAME>` (NAME = bare service name uppercased) →
  `LIFE_OPS_API_BASE`, but only when exactly one service is loaded. Multiple
  services with a missing per-service variable is an error naming the variable —
  fail closed, never dial one service's data from another's base. A single-value
  `LIFE_OPS_SERVICE` with `LIFE_OPS_API_BASE` behaves byte-identically to today.

Auth is unchanged: one token per process (`login`/`logout` as today,
`LIFE_OPS_CLIENT_ID=dev`, no new OAuth client). Every service takes the owner from
the verified token and accepts the `life-api` audience
(`packages/service-kit/src/auth/jwt-verifier.ts:49`), so
`LIFE_OPS_RESOURCE=https://life-ops` (IdP-mapped to `life-api`) serves all six.
