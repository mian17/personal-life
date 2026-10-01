import { TAG_NAME_MAX } from '@life/shared';

/**
 * Inline `#tag` parsing for the note composer. A token is recognized only when
 * its name run is followed by a terminator (a character outside
 * `[\p{L}\p{N}_-]`) — the Apple Reminders rule that stops a half-typed token
 * from creating a registry row on autosave. End-of-content is not a terminator
 * while typing; `eofTerminates: true` treats it as one for the final save when
 * the user leaves the note. The parsed *names* are sent through the registry's
 * create-or-get and the note write carries their `tagIds`
 * (`SPEC-tags-extraction`); the picker is an addition to this flow, not a
 * replacement.
 */

const INLINE_TAG = /#([\p{L}\p{N}_-]+)(?=[^\p{L}\p{N}_-])/gu;

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

export interface ParseInlineTagsOptions {
  eofTerminates?: boolean;
}

export function parseInlineTags(
  body: string,
  { eofTerminates = false }: ParseInlineTagsOptions = {},
): string[] {
  // Final mode appends a whitespace terminator, which is exactly equivalent to treating
  // end-of-content as a terminator: the appended space is a non-name character sitting
  // where the string ended, so it can only terminate a trailing name run and can never
  // create a new match. Strict mode is byte-identical to the old call.
  // ponytail: if the two modes ever diverge, swap the appended space for a dedicated
  // `(?=[^\p{L}\p{N}_-]|$)` boundary regex instead of string surgery.
  const source = eofTerminates ? body + ' ' : body;
  const names: string[] = [];
  for (const match of source.matchAll(INLINE_TAG)) {
    const name = normalizeName(match[1]);
    if (name) names.push(name);
  }
  return dedupeTags(names);
}

export function hasUncommittedTrailingTag(body: string): boolean {
  return parseInlineTags(body, { eofTerminates: true }).some(
    (name) => !parseInlineTags(body).includes(name),
  );
}
