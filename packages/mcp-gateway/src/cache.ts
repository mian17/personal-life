/**
 * The on-disk tool-table cache (SPEC-mcp-gateway §9.6): one JSON file beside the config,
 * `<configPath>.tools-cache.json`, holding per-upstream tool slices in their declared key order and
 * keyed by the config hash `config.ts` computes. The merged table is never stored here — `merge.ts`
 * assembles it in memory from these slices, so only tool metadata the upstreams already publish is
 * ever written.
 *
 * Reads are total: a missing file, an unreadable file, malformed JSON, a foreign file shape, or
 * another config's hash is a miss that reads as no slices at all, because the cache may never
 * cause unavailability.
 *
 * Writes are per-upstream, so a `list_changed` can drop exactly one key, and atomic (temp file then
 * rename), so a reader never sees half a file. An upstream that was down contributes no slice, its
 * absence is never persisted, and a later success fills its key in without disturbing the others.
 */
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import type { UpstreamSlice, UpstreamTool } from './merge.js';

/** Where this config's cache lives, and which config content it is allowed to answer for. */
export interface ToolCacheLocation {
  readonly path: string;
  readonly configHash: string;
}

/** The cache file's own shape: the config hash it was written for, then slices in declared order. */
interface CacheFile {
  readonly configHash: string;
  readonly slices: readonly UpstreamSlice[];
}

const CACHE_FILE_SUFFIX = '.tools-cache.json';

/** The cache sits beside the config file, so the two travel together. */
export function toolCacheFileFor(configPath: string): string {
  return `${configPath}${CACHE_FILE_SUFFIX}`;
}

/** Every slice this config's cache holds, in declared key order — no slices on any failure. */
export function readToolSlices(location: ToolCacheLocation): UpstreamSlice[] {
  const saved = savedCacheFile(location);
  return saved === undefined ? [] : [...saved.slices];
}

/** Insert or replace the given upstream slices, leaving every other slice where it sits. */
export function writeToolSlices(
  location: ToolCacheLocation,
  slices: readonly UpstreamSlice[],
): void {
  saveCacheFile(
    location,
    slices.reduce((held, slice) => insertedOrReplaced(held, slice), readToolSlices(location)),
  );
}

/** Forget one upstream's slice, leaving the other slices and their order untouched. */
export function dropToolSlice(location: ToolCacheLocation, configKey: string): void {
  const held = readToolSlices(location);
  const kept = held.filter((slice) => slice.configKey !== configKey);
  if (kept.length === held.length) return;
  saveCacheFile(location, kept);
}

/** The file's contents, but only when it belongs to this config hash. */
function savedCacheFile(location: ToolCacheLocation): CacheFile | undefined {
  const saved = cacheFileFrom(parsedJson(readQuietly(location.path)));
  if (saved === undefined) return undefined;
  return saved.configHash === location.configHash ? saved : undefined;
}

function readQuietly(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function parsedJson(contents: string | undefined): unknown {
  if (contents === undefined) return undefined;
  try {
    return JSON.parse(contents);
  } catch {
    return undefined;
  }
}

function cacheFileFrom(value: unknown): CacheFile | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.configHash !== 'string') return undefined;
  if (!Array.isArray(value.slices) || !value.slices.every(isUpstreamSlice)) return undefined;
  return { configHash: value.configHash, slices: value.slices };
}

function isUpstreamSlice(value: unknown): value is UpstreamSlice {
  if (!isRecord(value)) return false;
  if (typeof value.configKey !== 'string') return false;
  return Array.isArray(value.tools) && value.tools.every(isUpstreamTool);
}

function isUpstreamTool(value: unknown): value is UpstreamTool {
  return isRecord(value) && typeof value.name === 'string';
}

/** Put this slice where its key already sits, or after the keys held so far. */
function insertedOrReplaced(
  slices: readonly UpstreamSlice[],
  slice: UpstreamSlice,
): UpstreamSlice[] {
  const replaced = slices.map((existing) =>
    existing.configKey === slice.configKey ? slice : existing,
  );
  if (!holdsKey(slices, slice.configKey)) replaced.push(slice);
  return replaced;
}

function holdsKey(slices: readonly UpstreamSlice[], configKey: string): boolean {
  return slices.some((slice) => slice.configKey === configKey);
}

function saveCacheFile(location: ToolCacheLocation, slices: readonly UpstreamSlice[]): void {
  try {
    writeAtomically(location.path, JSON.stringify({ configHash: location.configHash, slices }));
  } catch {
    // ponytail: a lost write costs one upstream handshake on the next run and nothing else, so it
    // never fails the request that caused it. Upgrade path: report it on stderr once the server
    // owns a stderr writer.
  }
}

/** Temp file then rename, so a concurrent reader sees the old file or the new one, never half. */
function writeAtomically(path: string, contents: string): void {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, contents);
    renameSync(temporaryPath, path);
  } catch (error) {
    removeQuietly(temporaryPath);
    throw error;
  }
}

function removeQuietly(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // the temp file was never created, or the rename already moved it away
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
