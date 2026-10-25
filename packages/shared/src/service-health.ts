/**
 * The readiness contract every domain service shares (`SPEC-service-kernel`,
 * Health dialect). Each service binds its own datasource, master-key env, and
 * `degraded` error; the ordering and failure semantics live here once so the
 * five services cannot drift apart.
 *
 * Deliberately dependency-free: the caller supplies the `degraded` error factory
 * (`ServiceUnavailableException` in the Nest apps), so this module stays usable
 * from client-side code that imports `@life/shared`.
 */

/** The health body vocabulary. `200` carries `ok`; `503` carries `degraded`. */
export interface HealthBody {
  status: 'ok' | 'degraded';
}

export interface ReadinessChecks {
  /** Cheap round-trip proving the database is reachable. */
  queryDatabase(): Promise<unknown>;
  /** Throws when key custody is not configured (the master key does not load). */
  assertKeyCustody(): void;
  /** The error to throw when any check fails; a `503` in the Nest apps. */
  degraded(): Error;
}

/**
 * Run the readiness checks in order and report `ok`.
 *
 * The first failure short-circuits and becomes `degraded()`, so a caller never
 * sees a partial verdict. Nothing here is cached and nothing is written: the
 * probe is side-effect-free and safe to call continuously.
 */
export async function runReadinessChecks({
  queryDatabase,
  assertKeyCustody,
  degraded,
}: ReadinessChecks): Promise<HealthBody> {
  try {
    await queryDatabase();
    assertKeyCustody();
  } catch {
    throw degraded();
  }
  return { status: 'ok' };
}
