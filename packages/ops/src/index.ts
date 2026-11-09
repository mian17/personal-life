/**
 * `@life/ops` — shared data-operations platform (SPEC.md §5). The
 * programmatic surface future per-service modules register against.
 * Adapters render this registry; they never restate it (SPEC.md §3).
 *
 * SPEC.md §10.1: the package name `@life/ops` is provisional but FROZEN —
 * decision recorded per the name-freeze rule; do not rename after freeze.
 */
export type {
  FieldSpec,
  HttpMethod,
  OpSpec,
  ResourceRegistry,
  ResourceSpec,
  ValidationIssue,
  WireRequest,
} from './core/types.js';
export { defineResource, fieldEntry, fieldNames, findOp } from './core/registry.js';
export {
  BULK_KINDS,
  DEFAULT_BULK_LIMIT,
  assembleBulkEnvelope,
  bulkItemInput,
  bulkSourceKind,
  isBulkKind,
  resolveBulkLimit,
} from './core/bulk.js';
export type {
  BulkEnvelope,
  BulkFailedItem,
  BulkItemResult,
  BulkKind,
  BulkSucceededItem,
} from './core/bulk.js';
export { describeIssues, validateInput } from './core/validate.js';
export { deriveInputSchema, toolName } from './core/schema.js';
export type { JsonSchema, JsonSchemaProperty } from './core/schema.js';
export { wireFor } from './core/wire.js';
export {
  OpsError,
  invalidInputError,
  missingTokenError,
  operationLabel,
  renderOpsError,
} from './transport/errors.js';
export type { OpsErrorCode, OpsFailure } from './transport/errors.js';
export { createExecutor } from './transport/executor.js';
export type { Executor, ExecutorOptions, OpsResult } from './transport/executor.js';
export { login, resolveLoginOptions } from './auth/login.js';
export type { IdpEndpoints, LoginOptions } from './auth/login.js';
export { refresh } from './auth/refresh.js';
export type { RefreshOptions } from './auth/refresh.js';
export { currentAccessToken } from './auth/token-provider.js';
export {
  clearTokens,
  credentialsPath,
  readToken,
  readTokens,
  storeTokens,
} from './auth/token-store.js';
export type { StoredTokens } from './auth/token-store.js';
