import 'server-only';
import type { CreateFeedbackInput, FeedbackDto, FeedbackStatus } from '@life/shared';
import { callService } from './client';

const FEEDBACK_API_URL = process.env.FEEDBACK_API_URL ?? 'http://127.0.0.1:3008';

export { ApiError } from './client';

function call<T>(path: string, init?: RequestInit): Promise<T> {
  return callService<T>(FEEDBACK_API_URL, path, init);
}

/**
 * `GET /api/feedback` on feedback-service — the owner's entries, newest-first,
 * no pagination in v1. Auth/owner-scoping are the service's job (Contract 2);
 * the BFF only forwards the caller's token.
 */
export function listFeedback(): Promise<FeedbackDto[]> {
  return call<FeedbackDto[]>('/api/feedback');
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