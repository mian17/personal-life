import 'server-only';
import type { CreateFeedbackInput, FeedbackDto, FeedbackPage, FeedbackStatus } from '@life/shared';
import { callService } from './client';

const FEEDBACK_API_URL = process.env.FEEDBACK_API_URL ?? 'http://127.0.0.1:3008';

export { ApiError } from './client';

function call<T>(path: string, init?: RequestInit): Promise<T> {
  return callService<T>(FEEDBACK_API_URL, path, init);
}

/**
 * `GET /api/feedback` on feedback-service — one cursor page of the owner's
 * entries, newest-first. Auth/owner-scoping are the service's job (Contract 2);
 * the BFF only forwards the caller's token.
 */
export function listFeedbackPage(opts: { limit?: number; cursor?: string } = {}): Promise<FeedbackPage> {
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.cursor !== undefined) params.set('cursor', opts.cursor);
  const qs = params.toString();
  return call<FeedbackPage>(`/api/feedback${qs ? `?${qs}` : ''}`);
}

/**
 * Every one of the owner's entries, walked page by page (`collectTodos`'s pattern).
 * Two callers genuinely need the whole set: the detail route has no per-id GET, so
 * it finds its entry inside the list, and the inbox groups by app then type. The
 * load-more UI is a later task and will call `listFeedbackPage` directly.
 */
export async function listFeedback(maxItems = 1000): Promise<FeedbackDto[]> {
  const collected: FeedbackDto[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await listFeedbackPage({ cursor });
    collected.push(...page.feedback);
    if (collected.length >= maxItems || !page.nextCursor) {
      return collected.slice(0, maxItems);
    }
    cursor = page.nextCursor;
  }
}

/**
 * `POST /api/feedback` — `201 { id }`. The client-supplied `id` is the
 * idempotency key, so a retry or double-tap returns the same 201 (never 409).
 */
export function createFeedback(input: CreateFeedbackInput): Promise<{ id: string }> {
  return call<{ id: string }>('/api/feedback', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * `PATCH /api/feedback/:id` — `200 { id, status }`. Owner scoping and the
 * vocabulary check are the service's job; the BFF only forwards the caller's
 * token, exactly like `createFeedback`.
 */
export function updateFeedbackStatus(
  id: string,
  status: FeedbackStatus,
): Promise<{ id: string; status: FeedbackStatus }> {
  return call<{ id: string; status: FeedbackStatus }>(`/api/feedback/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}