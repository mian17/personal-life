'use server';

import { revalidatePath } from 'next/cache';
import {
  fetchSettings,
  recordSitting,
  saveSettings,
  type SittingOutcome,
} from '@/lib/meditation-api';
import { cappedMinutes, minuteUnit, type BellChoice } from '@/lib/meditation-clock';
import { getToday } from '@/lib/today';

/**
 * The sitting lifecycle as the server sees it (`SPEC-meditation-app` §1, §5): two writes, and
 * nothing for the other two endings.
 *
 * Starting a sitting writes nothing — a running sitting is not persisted, so there is no row to
 * create (spec assumption 4). Abandoning writes nothing either: an abandoned sitting has no
 * route and no minutes, so the client simply leaves the countdown.
 *
 * The day is resolved by the shared `getToday()` owner, never by the browser clock, so a sitting
 * belongs to the client's own local day. The minutes are the service's decision: the client
 * reports how long it sat and how it ended.
 */

/** What the client knows about a sitting it just ran; the day, the end time and the ending are added here. */
export interface SittingReport {
  startedAt: string;
  plannedMinutes: number;
  /** Seconds actually sat — the whole planned length on a natural finish. */
  elapsedSeconds: number;
}

/** Record a sitting that ran its planned length; the service stores the planned minutes as complete. */
export async function recordFinishedSitting(report: SittingReport): Promise<void> {
  await sendReport(report, 'finished');
}

/** Record an early stop the sitter kept; the service rounds it up, floors it at one, caps it at planned. */
export async function recordKeptSitting(report: SittingReport): Promise<void> {
  await sendReport(report, 'kept');
}

/** One write: the client's report, stamped with the local day it ended in and the ending it chose. */
async function sendReport(report: SittingReport, outcome: SittingOutcome): Promise<void> {
  const day = await getToday();
  await recordSitting({ ...report, endedAt: new Date().toISOString(), day, outcome });
  announceRecordedSitting({
    day,
    minutes: cappedMinutes(report.elapsedSeconds, report.plannedMinutes),
    outcome,
  });
  revalidatePath('/meditation');
}

/** The line one recorded sitting leaves in the dev console: the day, the minutes that landed, the ending. */
interface RecordedSittingLog {
  day: string;
  minutes: number;
  outcome: SittingOutcome;
}

/**
 * The one line a recorded sitting leaves — what Task 9's manual check reads back, and the only
 * place the minutes are visible before Task 10 adds the log screen. The line is debug-level and
 * skipped in production: it only prints when someone raises the console level outside a
 * production run, so customer activity never reaches the production log.
 *
 * The minutes are `cappedMinutes`, the same rule the stop dialog shows, so the log cannot
 * disagree with the number the sitter just confirmed. Logged after the write: this is the row
 * that landed, not the report that was sent.
 */
function announceRecordedSitting({ day, minutes, outcome }: RecordedSittingLog): void {
  if (process.env.NODE_ENV === 'production') return;
  console.debug(`meditation: recorded ${minutes} ${minuteUnit(minutes)} (${outcome}) for ${day}`);
}

/**
 * The interval bells sheet's write: the `bells` the sheet saved, stored over the ones the settings
 * already hold.
 *
 * Reading first is what keeps this write to the field it owns — the sheet edits the bells and
 * nothing else, so the goal and the planned length go back to the service exactly as they came.
 *
 * A refused or unreachable service rejects here rather than resolving, which is how the sheet
 * learns the save did not land: it keeps its draft open instead of reporting success.
 */
export async function saveIntervalBells(bells: BellChoice): Promise<void> {
  const settings = await fetchSettings();
  await saveSettings({ ...settings, bells });
  revalidatePath('/meditation');
}
