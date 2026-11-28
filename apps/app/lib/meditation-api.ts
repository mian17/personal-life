import 'server-only';
import { callService } from './client';
import type { BellChoice } from './meditation-clock';
import { getToday } from './today';

/**
 * The meditation-service client (`SPEC-meditation-app` §1): one owner's settings, the
 * sitting lifecycle, and the day-done read.
 *
 * The service decides every number it stores — the client reports how long it sat and
 * how the sitting ended, and `recordedSitting` caps and rounds from there. Nothing here
 * re-derives those minutes.
 */

/** The owner's whole configuration: the daily goal, the planned length, and the bells. */
export interface SettingsRow {
  goalMinutes: number;
  plannedMinutes: number;
  bells: BellChoice;
}

/** One recorded sitting, as `GET /sessions` serves it. */
export interface SittingRow {
  id: string;
  /** The client's own local day the sitting ended in, `YYYY-MM-DD`. */
  day: string;
  startedAt: string;
  endedAt: string;
  plannedMinutes: number;
  /** The minutes recorded: the planned length, or what was sat and kept. */
  minutes: number;
  completed: boolean;
  /** `null` on a live sitting; a delete stamps this and never removes the row. */
  deletedAt: string | null;
  createdAt: string;
}

/** One page of the owner's sitting log plus the cursor that continues it. */
export interface SittingPage {
  sessions: SittingRow[];
  nextCursor: string | null;
  /** How many live sittings the owner has — the set this page was sliced from. */
  total: number;
}

/** One day measured against the goal as it stands at this read. */
export interface DayDoneRow {
  date: string;
  liveMinutes: number;
  goalMinutes: number;
  done: boolean;
}

/** One day's goal, as `GET /settings/goals` serves it: the day it took effect on, and its minutes. */
export interface GoalRow {
  validFrom: string;
  minutes: number;
}

/** How a sitting ended: on its own planned length, or stopped early and kept. */
export type SittingOutcome = 'finished' | 'kept';

/** A sitting as the client reports it — the times it ran, the length, and the ending the sitter chose. */
export interface SittingDraft {
  /** The client's own local day, `YYYY-MM-DD`. */
  day: string;
  startedAt: string;
  endedAt: string;
  plannedMinutes: number;
  /** Seconds actually sat; the service rounds them up, floors at one, and caps at planned. */
  elapsedSeconds: number;
  outcome: SittingOutcome;
}

const MEDITATION_API_URL = process.env.MEDITATION_API_URL ?? 'http://127.0.0.1:3109';

function call<T>(path: string, init?: RequestInit): Promise<T> {
  return callService<T>(MEDITATION_API_URL, path, init);
}

/** `GET /settings` — the owner's configuration, or the fresh-owner defaults before the first write. */
export function fetchSettings(): Promise<SettingsRow> {
  return call<SettingsRow>('/settings');
}

/**
 * `PUT /settings` — replace the owner's whole configuration; the goal clamps on the way in.
 *
 * The client's own day rides along, from the one owner of "today", so the service can file the
 * goal into that day's history row: without it the settings row would answer today's aim while
 * no past day had a goal to resolve. The answer is the settings content alone — the day is not
 * part of it.
 */
export async function saveSettings(settings: SettingsRow): Promise<SettingsRow> {
  const date = await getToday();
  return call<SettingsRow>('/settings', {
    method: 'PUT',
    body: JSON.stringify({ ...settings, date }),
  });
}

/** `GET /settings/goals` — the owner's whole goal history, oldest first. */
export function fetchGoals(): Promise<GoalRow[]> {
  return call<GoalRow[]>('/settings/goals');
}

/** `POST /sessions` — record one finished sitting; the service answers with the row it stored. */
export function recordSitting(draft: SittingDraft): Promise<SittingRow> {
  return call<SittingRow>('/sessions', { method: 'POST', body: JSON.stringify(draft) });
}

/** `GET /sessions/days?from=&to=` — every day of the window, measured against the current goal. */
export function fetchDayDone(from: string, to: string): Promise<DayDoneRow[]> {
  const query = new URLSearchParams({ from, to });
  return call<DayDoneRow[]>(`/sessions/days?${query}`);
}

/** `GET /sessions` — one page of the owner's live sittings, newest day first; `cursor` is opaque. */
export function fetchSittingPage(cursor?: string): Promise<SittingPage> {
  const query = cursor === undefined ? '' : `?${new URLSearchParams({ cursor })}`;
  return call<SittingPage>(`/sessions${query}`);
}

/** `GET /sessions/:id` — one live sitting; a deleted or foreign id is the service's 404. */
export function fetchSitting(sittingId: string): Promise<SittingRow> {
  return call<SittingRow>(`/sessions/${sittingId}`);
}

/**
 * `DELETE /sessions/:id` — stamp the delete. There is no restore: the row leaves every
 * read and stays in `meditation.db` (`SPEC-meditation-app` §10.1).
 */
export function deleteSitting(sittingId: string): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(`/sessions/${sittingId}`, { method: 'DELETE' });
}
