/**
 * The canonical renderings both adapters print (SPEC.md §3): success is one
 * stable JSON view of the service body, failure delegates to the single
 * `renderOpsError` shape. The MCP adapter prints these same strings, so output
 * parity is a string comparison rather than a convention.
 */
import type { OpsResult } from '../transport/executor';
import { OpsError, renderOpsError } from '../transport/errors';

/** The service body as the one canonical success output; an empty body renders empty. */
export function renderOpsResult(result: OpsResult): string {
  return result.body === undefined ? '' : JSON.stringify(result.body, null, 2);
}

/** The one canonical failure output; anything outside the typed shape surfaces its message. */
export function renderFailure(error: unknown): string {
  if (error instanceof OpsError) return renderOpsError(error);
  return error instanceof Error ? error.message : String(error);
}
