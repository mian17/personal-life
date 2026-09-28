import 'server-only';
import type { TagUsage } from '@life/shared';
import { createOrGetTag, resolveTags } from './tags-api';

/**
 * BFF composition over the kernel's `TagRef` contract (`SPEC-service-kernel`,
 * MAP M4): domain services store only integer ids; names live solely in
 * `tags-service`. These helpers resolve usage surfaces to names and turn inline
 * `#tag` names into ids — the two things every tag-aware page/action needs.
 */

export interface NamedTagUsage {
  tagId: number;
  count: number;
  name: string;
}

/**
 * Resolve a domain's `[{tagId, count}]` usage surface to names via **one** batch
 * `resolve` call, dropping usage rows whose id the registry does not return
 * (kernel detach semantics: an omitted id is detached, so it must not render).
 * Ids are deduped before the call so a large surface never fans out requests.
 */
export async function resolveTagUsage(usage: TagUsage[]): Promise<NamedTagUsage[]> {
  if (usage.length === 0) return [];
  const ids = [...new Set(usage.map((row) => row.tagId))];
  const resolved = await resolveTags(ids);
  const names = new Map(resolved.map((tag) => [tag.id, tag.name]));
  return usage
    .filter((row) => names.has(row.tagId))
    .map((row) => ({ tagId: row.tagId, count: row.count, name: names.get(row.tagId)! }));
}

/**
 * Create-or-get each unique inline `#tag` name in the registry and return the
 * ids. Names are deduped case-insensitively keeping first-seen casing (the
 * registry is case-insensitive too, so a body mentioning `#Work` and `#work`
 * costs one round trip).
 */
export async function resolveInlineTagIds(names: string[]): Promise<number[]> {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(name);
  }
  const tags = await Promise.all(unique.map((name) => createOrGetTag(name)));
  return tags.map((tag) => tag.id);
}

/**
 * Keep only ids the registry still resolves (kernel detach semantics): a tag
 * deleted in the other app must not be written back onto the next save. A
 * `resolve` failure rethrows (a degraded registry fails the write closed rather
 * than persisting dangling ids); only *omission* is treated as detach. The input
 * order is preserved and duplicates removed.
 */
export async function retainedTagIds(ids: number[]): Promise<number[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const resolved = await resolveTags(unique);
  const live = new Set(resolved.map((tag) => tag.id));
  return unique.filter((id) => live.has(id));
}
