import 'server-only';
import { NOTE_BODY_MAX, TAG_NAME_MAX } from '@life/shared';
import { ApiError } from './api-error';

const MAX_TAG_IDS = 200;
const MAX_INLINE_TAGS = 100;

function isInlineTagNames(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_INLINE_TAGS &&
    value.every((item: unknown) => typeof item === 'string' && item.length <= TAG_NAME_MAX)
  );
}

function isTagIds(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_TAG_IDS &&
    value.every((item: unknown) => typeof item === 'number' && Number.isInteger(item) && item > 0)
  );
}

/**
 * The flush route's payload. `inlineTagNames` are the `#tag` names parsed from
 * the body; `tagIds` are the explicitly attached registry ids. The route
 * resolves both through the registry's create-or-get and writes the union as
 * `tagIds` (`SPEC-tags-extraction`).
 *
 * Both fields are optional so a client can send only one, but at least the body
 * is always required.
 */
export type FlushPayload =
  | {
      ok: true;
      body: string;
      inlineTagNames: string[];
      tagIds: number[];
      expectedVersion?: number;
    }
  | { ok: false; error: string };

export async function readFlushPayload(req: Request): Promise<FlushPayload> {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return { ok: false, error: 'invalid json' };
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, error: 'invalid body' };
  }

  const { body, inlineTagNames, tagIds, expectedVersion } = payload as {
    body?: unknown;
    inlineTagNames?: unknown;
    tagIds?: unknown;
    expectedVersion?: unknown;
  };
  if (typeof body !== 'string' || body.length > NOTE_BODY_MAX) {
    return { ok: false, error: 'invalid body' };
  }
  if (inlineTagNames !== undefined && !isInlineTagNames(inlineTagNames)) {
    return { ok: false, error: 'invalid inline tags' };
  }
  if (tagIds !== undefined && !isTagIds(tagIds)) {
    return { ok: false, error: 'invalid tag ids' };
  }
  // Absent means unconditional (create / legacy client); present must be a valid
  // non-negative integer so a malformed version fails loudly instead of editing.
  if (expectedVersion === undefined) {
    return { ok: true, body, inlineTagNames: inlineTagNames ?? [], tagIds: tagIds ?? [] };
  }
  if (
    typeof expectedVersion !== 'number' ||
    !Number.isInteger(expectedVersion) ||
    expectedVersion < 0
  ) {
    return { ok: false, error: 'invalid version' };
  }
  return {
    ok: true,
    body,
    inlineTagNames: inlineTagNames ?? [],
    tagIds: tagIds ?? [],
    expectedVersion,
  };
}

export function apiErrorStatus(error: unknown): number | null {
  if (error instanceof ApiError) return error.status;
  if (!(error instanceof Error)) return null;
  const match = /^API (\d{3}) on /.exec(error.message);
  return match ? Number(match[1]) : null;
}
