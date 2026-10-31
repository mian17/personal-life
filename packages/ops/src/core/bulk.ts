/**
 * The bulk vocabulary (SPEC-bulk-ops §2.1, §2.4, §2.7, §2.9): the one table that
 * maps a bulk kind to the single-row kind it fans out over and to the shape one
 * of its items has, the cap every bulk call obeys, the result envelope, and the
 * per-item input derivation. Registry, validator, schema, executor, and both
 * adapters read this module; a second copy of any mapping here is a bug.
 */
import type { OpSpec } from './types';
import { ADDRESSING_FIELD } from './wire';

/** The four kinds a `bulk: true` resource declares (SPEC-bulk-ops §2.1). */
export type BulkKind = 'getMany' | 'createMany' | 'updateMany' | 'deleteMany';

/** What one bulk kind fans out over, and what one of its submitted items is. */
interface BulkSource {
  /** The single-row kind one item is sent as. */
  kind: OpSpec['kind'];
  /** A bare id is the whole item; otherwise the item is a payload object. */
  itemIsPlainId: boolean;
}

/** Declaration order is the order derivation appends the four kinds in (§2.1). */
const BULK_SOURCES: Readonly<Record<BulkKind, BulkSource>> = {
  getMany: { kind: 'get', itemIsPlainId: true },
  createMany: { kind: 'create', itemIsPlainId: false },
  updateMany: { kind: 'update', itemIsPlainId: false },
  deleteMany: { kind: 'delete', itemIsPlainId: true },
};

/** The four kinds in the order derivation appends them — the table's own key order. */
export const BULK_KINDS: readonly BulkKind[] = Object.keys(BULK_SOURCES) as BulkKind[];

export function isBulkKind(kind: OpSpec['kind']): kind is BulkKind {
  return BULK_KINDS.includes(kind as BulkKind);
}

/** The single-row kind this bulk kind fans out over, or `undefined` for the six existing kinds. */
export function bulkSourceKind(kind: OpSpec['kind']): OpSpec['kind'] | undefined {
  return isBulkKind(kind) ? BULK_SOURCES[kind].kind : undefined;
}

/** The cap one bulk call obeys, in items (§2.4). */
export const DEFAULT_BULK_LIMIT = 10;

/**
 * The cap this environment asks for. A broken value falls back to the default
 * rather than uncapping the model-facing surface, so `0` is not "unlimited".
 */
export function resolveBulkLimit(env: NodeJS.ProcessEnv): number {
  const configured = env.LIFE_OPS_BULK_LIMIT?.trim();
  if (configured === undefined || configured === '') return DEFAULT_BULK_LIMIT;
  const parsed = Number(configured);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : DEFAULT_BULK_LIMIT;
}

/** One submitted item that ran, carrying the body its single-row call returned. */
export interface BulkSucceededItem<Item = unknown, Body = unknown> {
  index: number;
  status: 'succeeded';
  item: Item;
  /** Omitted when the single-row body is `undefined`, as a bodiless delete's is. */
  ref?: Body;
}

/** One submitted item that did not run, carrying the single-row call's own message. */
export interface BulkFailedItem<Item = unknown> {
  index: number;
  status: 'failed';
  item: Item;
  error: string;
}

/** Every submitted item's outcome, in submitted order (§2.7). */
export type BulkItemResult<Item = unknown, Body = unknown> =
  | BulkSucceededItem<Item, Body>
  | BulkFailedItem<Item>;

/** The one body a bulk op returns: counts derived from the entries, never tracked apart. */
export interface BulkEnvelope<Item = unknown, Body = unknown> {
  total: number;
  succeeded: number;
  failed: number;
  results: BulkItemResult<Item, Body>[];
}

/** The envelope of one finished batch, with each item echoed exactly once (§2.7). */
export function assembleBulkEnvelope<Item, Body>(
  results: BulkItemResult<Item, Body>[],
): BulkEnvelope<Item, Body> {
  const succeeded = results.filter((result) => result.status === 'succeeded').length;
  return { total: results.length, succeeded, failed: results.length - succeeded, results };
}

/**
 * The input one submitted item becomes for its source kind: a bare id wrapped in
 * the addressing field, or the payload object the caller sent unchanged (§2.3).
 */
export function bulkItemInput(kind: BulkKind, item: unknown): Record<string, unknown> {
  return BULK_SOURCES[kind].itemIsPlainId
    ? { [ADDRESSING_FIELD]: item }
    : (item as Record<string, unknown>);
}
