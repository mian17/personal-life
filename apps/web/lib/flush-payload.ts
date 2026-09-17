import 'server-only';
import { NOTE_BODY_MAX, TAG_NAME_MAX } from '@life/shared';
import { ApiError } from './api';

function isTagArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown) => typeof item === 'string' && item.length <= TAG_NAME_MAX)
  );
}

export type FlushPayload =
  | { ok: true; body: string; tags: string[] }
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

  const { body, tags } = payload as { body?: unknown; tags?: unknown };
  if (typeof body !== 'string' || body.length > NOTE_BODY_MAX) {
    return { ok: false, error: 'invalid body' };
  }
  if (!isTagArray(tags)) {
    return { ok: false, error: 'invalid tags' };
  }

  return { ok: true, body, tags };
}

export function apiErrorStatus(error: unknown): number | null {
  if (error instanceof ApiError) return error.status;
  if (!(error instanceof Error)) return null;
  const match = /^API (\d{3}) on /.exec(error.message);
  return match ? Number(match[1]) : null;
}
