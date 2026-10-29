import 'server-only';
import { callService } from './client';

/** One recorded focus block, as `focus-service` serves it (`SPEC-focus-service` §1). */
export interface SessionRow {
  id: string;
  /** Nullable in the column (legacy rows may predate the owner stamp); every served row carries the caller's `sub`. */
  ownerSub: string | null;
  date: string;
  minutes: number;
  createdAt: string;
}

/**
 * One dated goal row, as served: the day it takes effect on and the daily
 * minutes. A later set replaces its own day's row only, so past days keep the
 * goal that applied then; the day→goal resolution belongs to the app, not here.
 */
export interface GoalRow {
  validFrom: string;
  minutes: number;
}

const FOCUS_API_URL = process.env.FOCUS_API_URL ?? 'http://127.0.0.1:3107';

function call<T>(path: string, init?: RequestInit): Promise<T> {
  return callService<T>(FOCUS_API_URL, path, init);
}

/**
 * `GET /api/sessions?from=&to=` — the owner's raw rows between two client
 * days. Both bounds are the caller's (`getToday()` and the bucket window), so
 * the range enters the query string rather than being derived from a clock here.
 */
export function listSessions(from: string, to: string): Promise<SessionRow[]> {
  return call<SessionRow[]>(`/api/sessions?${new URLSearchParams({ from, to })}`);
}

/** `POST /api/sessions` — one recorded block for the caller's own day. */
export function recordSession(date: string, minutes: number): Promise<SessionRow> {
  return call<SessionRow>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ date, minutes }),
  });
}

/** `GET /api/goal` — every goal row the owner has, oldest first. */
export function listGoals(): Promise<GoalRow[]> {
  return call<GoalRow[]>('/api/goal');
}

/** `PUT /api/goal` — set the goal effective on `date`, replacing only that day's row. */
export function setGoal(date: string, minutes: number): Promise<GoalRow> {
  return call<GoalRow>('/api/goal', {
    method: 'PUT',
    body: JSON.stringify({ date, minutes }),
  });
}
