import { navActions, withQuery } from '@life/app-kit';
import {
  ButtonLink,
  EmptyState,
  formatLongDate,
  List,
  ListItem,
  ListShell,
  Pill,
  Stack,
} from '@life/ui';
import { fetchSittingPage, type SittingPage, type SittingRow } from '@/lib/meditation-api';
import { minuteUnit } from '@/lib/meditation-clock';

export const dynamic = 'force-dynamic';

/**
 * `/meditation/sessions` — the sitting log (`SPEC-meditation-app` §1, §10.2): the owner's live
 * sittings, newest first, each row a date with the minutes it kept and whether it ran its
 * planned length.
 *
 * A stamped sitting never reaches this screen: the service lists `deletedAt IS NULL` rows only,
 * so the log cannot disagree with the day reads that sum those same rows.
 *
 * The next page is a link, not an appended feed: `?cursor=` names it, so the screen stays one
 * server render with no client state and a reload re-opens the page the URL names.
 */
export default async function SessionsRoute({
  searchParams,
}: Readonly<{ searchParams: Promise<{ cursor?: string }> }>) {
  const { cursor } = await searchParams;
  const page = await fetchSittingPage(cursor);

  return (
    <ListShell
      title="Sitting log"
      subtitle={sittingCountLine(page.total)}
      navTrailing={navActions('meditation')}
      body={<SittingLog page={page} />}
    />
  );
}

/** The rows, or the empty state a sitter who has not finished a sitting yet deserves. */
function SittingLog({ page }: Readonly<{ page: SittingPage }>) {
  if (page.sessions.length === 0) {
    return (
      <EmptyState
        heading="No sittings yet."
        body="Finish a sitting on the meditation screen and it lands here."
      />
    );
  }

  return (
    <Stack gap="lg">
      <List>
        {page.sessions.map((sitting) => (
          <SittingItem key={sitting.id} sitting={sitting} />
        ))}
      </List>
      {page.nextCursor !== null && (
        <ButtonLink href={olderPageHref(page.nextCursor)} variant="ghost">
          Older sittings
        </ButtonLink>
      )}
    </Stack>
  );
}

/** One sitting: the day it belongs to, the minutes it kept against its plan, and how it ended. */
function SittingItem({ sitting }: Readonly<{ sitting: SittingRow }>) {
  const kept = `${sitting.minutes} ${minuteUnit(sitting.minutes)}`;
  const planned = `${sitting.plannedMinutes} ${minuteUnit(sitting.plannedMinutes)} planned`;

  return (
    <ListItem
      href={`/meditation/sessions/${sitting.id}`}
      title={formatLongDate(sitting.day)}
      meta={`${kept} of ${planned}`}
      trailing={
        <Pill tone={completionPillTone(sitting.completed)}>
          {completionLabel(sitting.completed)}
        </Pill>
      }
    />
  );
}

/** The page after `cursor`, spelled the one way this app appends a query suffix. */
function olderPageHref(cursor: string): string {
  return withQuery('/meditation/sessions', new URLSearchParams({ cursor }));
}

/** How many live sittings the log is a slice of — the service's own count, never this page's. */
function sittingCountLine(total: number): string {
  return total === 1 ? '1 sitting recorded' : `${total} sittings recorded`;
}

/**
 * A finished sitting reads as done and a stopped-and-kept one does not, at a glance — one
 * vocabulary the log row and the detail sub-line share word for word.
 */
function completionLabel(completed: boolean): string {
  return completed ? 'Complete' : 'Kept early';
}

/** The done tint belongs to the finished sitting alone; a kept one stays the neutral pill. */
function completionPillTone(completed: boolean): string | undefined {
  return completed ? 'done' : undefined;
}
