import { TAG_NAME_MAX } from '@life/shared';

const INLINE_TAG = /#([^\s#]+)/g;

function normalizeName(raw: string): string | null {
  const name = raw.trim().slice(0, TAG_NAME_MAX);
  return name.length > 0 ? name : null;
}

export function dedupeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function parseInlineTags(body: string): string[] {
  const names: string[] = [];
  for (const match of body.matchAll(INLINE_TAG)) {
    const name = normalizeName(match[1]);
    if (name) names.push(name);
  }
  return dedupeTags(names);
}
