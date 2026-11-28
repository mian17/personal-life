import { loadOrNotFound } from '@life/app-kit';
import {
  Card,
  ConfirmButton,
  Facts,
  FactsRow,
  formatLongDate,
  LocalTime,
  ManagerBlock,
  PageActions,
  Pill,
} from '@life/ui';
import { fetchSitting, type SittingRow } from '@/lib/meditation-api';
import { minuteUnit } from '@/lib/meditation-clock';
import { deleteSittingAction } from '../actions';

export const dynamic = 'force-dynamic';

/**
 * `/meditation/sessions/:id` — one sitting's whole record (`SPEC-meditation-app` §1, §10.2): when
 * it ran, what it was planned for, what it kept, and how it ended.
 *
 * A stamped or foreign id is the service's 404, so a deleted sitting has no page at all — the
 * delete is a `deletedAt` stamp with no restore and no trash surface (§10.1), and nothing this
 * screen offers can bring the row back.
 */
export default async function SittingDetailRoute({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const sitting = await loadOrNotFound(() => fetchSitting(id));

  return (
    <ManagerBlock
      title={formatLongDate(sitting.day)}
      backHref="/meditation/sessions"
      sub={
        <Pill tone={completionPillTone(sitting.completed)}>
          {completionLabel(sitting.completed)}
        </Pill>
      }
    >
      <Card>
        <SittingFacts sitting={sitting} />
      </Card>
      <PageActions>
        <form action={deleteSittingAction.bind(null, sitting.id)}>
          <ConfirmButton
            variant="danger"
            message="Delete this sitting? It leaves your log and the day it counted toward, and cannot be restored."
          >
            Delete sitting
          </ConfirmButton>
        </form>
      </PageActions>
    </ManagerBlock>
  );
}

/**
 * The record itself: the days it ran, the plan it faced, the minutes it kept, and the recording.
 *
 * Days, not clock hours: `LocalTime` is the only zone-correct time primitive and it reads a date,
 * so the hour waits for a time-of-day primitive upstream (Contract 1 Rule 3) rather than being
 * formatted here from the host's zone.
 */
function SittingFacts({ sitting }: Readonly<{ sitting: SittingRow }>) {
  return (
    <Facts>
      <FactsRow label="Started on" value={<LocalTime dateTime={sitting.startedAt} />} />
      <FactsRow label="Ended on" value={<LocalTime dateTime={sitting.endedAt} />} />
      <FactsRow
        label="Planned"
        value={`${sitting.plannedMinutes} ${minuteUnit(sitting.plannedMinutes)}`}
      />
      <FactsRow label="Kept" value={`${sitting.minutes} ${minuteUnit(sitting.minutes)}`} />
      <FactsRow label="Recorded" value={<LocalTime dateTime={sitting.createdAt} />} />
    </Facts>
  );
}

/**
 * A finished sitting reads as done and a stopped-and-kept one does not, at a glance — the log
 * row's own two words, so the log and this page cannot describe one sitting differently.
 */
function completionLabel(completed: boolean): string {
  return completed ? 'Complete' : 'Kept early';
}

/** The done tint belongs to the finished sitting alone; a kept one stays the neutral pill. */
function completionPillTone(completed: boolean): string | undefined {
  return completed ? 'done' : undefined;
}
