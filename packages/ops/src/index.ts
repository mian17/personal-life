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
} from './core/types';
export { defineResource, fieldEntry, fieldNames, findOp } from './core/registry';
export { describeIssues, validateInput } from './core/validate';
export { deriveInputSchema, toolName } from './core/schema';
export type { JsonSchema, JsonSchemaProperty } from './core/schema';
export { wireFor } from './core/wire';
export {
  OpsError,
  invalidInputError,
  missingTokenError,
  operationLabel,
  renderOpsError,
} from './transport/errors';
export type { OpsErrorCode, OpsFailure } from './transport/errors';
export { createExecutor } from './transport/executor';
export type { Executor, ExecutorOptions, OpsResult } from './transport/executor';
export { login, resolveLoginOptions } from './auth/login';
export type { IdpEndpoints, LoginOptions } from './auth/login';
export { refresh } from './auth/refresh';
export type { RefreshOptions } from './auth/refresh';
export { clearTokens, credentialsPath, readToken, readTokens, storeTokens } from './auth/token-store';
export type { StoredTokens } from './auth/token-store';
