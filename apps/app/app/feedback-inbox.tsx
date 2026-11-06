import type { CreateFeedbackInput, FeedbackDto, FeedbackStatus, FeedbackSubmitResult } from '@life/shared';
import { FEEDBACK_APPS } from '@life/shared';
import {
  EmptyState,
  feedbackStatusOption,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
  List,
  ListShell,
  Section,
  TagFilterNav,
} from '@life/ui';
import { filterHref, navActions } from '@life/app-kit';
import { FeedbackRow } from './feedback-row';

const APP_LABELS: Record<string, string> = { notes: 'Notes', todos: 'Todos', meals: 'Meals', feedback: 'Feedback' };
const APP_ORDER = FEEDBACK_APPS;
const TYPE_ORDER = FEEDBACK_TYPES.map((t) => t.value);
const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  FEEDBACK_TYPES.map((t) => [t.value, t.label]),
);

const EMPTY_HEADING = 'No feedback yet.';
const EMPTY_BODY = 'Open Settings → Send feedback to write the first one.';
/** §8's `.phead__sub`: the one line under the title saying what the inbox spans. */
const INBOX_SUBTITLE = 'Across all five modules';

/**
 * A filter that hides every entry is not an empty inbox (`SPEC-feedback-status`
 * §4): the frozen `EMPTY_*` strings stay for a genuinely empty list, and this
 * message names the active filter instead.
 */
function matchesNothingState(status: FeedbackStatus): { heading: string; body: string } {
  const { label } = feedbackStatusOption(status);
  return { heading: `No ${label} feedback.`, body: `Try another status or switch back to All.` };
}

/** §8's `.slabel__count`: the row count read at the far end of an app's group label. */
function entryCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'entry' : 'entries'}`;
}

/** Canonical ids first, unknown ids last (alphabetical). */
function compareCodeUnits(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function orderedKeys(keys: string[], canonical: readonly string[]): string[] {
  const known = canonical.filter((key) => keys.includes(key));
  // Code-unit order (not `localeCompare`) to keep the previous default-sort semantics.
  const unknown = keys
    .filter((key) => !canonical.includes(key))
    .sort(compareCodeUnits);
  return [...known, ...unknown];
}

/**
 * The filter row: All plus one chip per status — data straight from
 * `FEEDBACK_STATUSES`, so a vocabulary change rerenders here too. It is the notes
 * index's `TagFilterNav` shape (one row of link chips, All pinned at the leading
 * edge): the filter lives in the URL (`?status=done`; All drops the param), so the
 * view is shareable and the server renders the one the owner asked for.
 */
function StatusFilter({ status }: Readonly<{ status: FeedbackStatus | undefined }>) {
  const allStatus = {
    name: 'All',
    href: filterHref({ path: '/feedback', overrides: { status: undefined } }),
    active: status === undefined,
  };
  const statusFilters = FEEDBACK_STATUSES.map(({ value, label }) => ({
    name: label,
    href: filterHref({ path: '/feedback', overrides: { status: value } }),
    active: status === value,
  }));

  return <TagFilterNav aria-label="Status" pinned={allStatus} items={statusFilters} />;
}

/**
 * The `/feedback` owner inbox (app glue, like `note-list.tsx`): it groups and
 * renders, it never fetches. The `status` filter arrives from the URL and narrows
 * the already-loaded list in render (`undefined` = All) — no refetch, no
 * service-side filtering (Contract 2 Rule 3 keeps filters out of the cache key
 * regardless). Buckets preserve encounter order — the service already returns
 * newest-first, so stable bucketing keeps every group newest-first without a
 * re-sort. One row type: `ListItem variant="feedback"` (lesson 0018).
 */
export function FeedbackInbox({
  entries,
  status,
  setFeedbackStatusAction,
}: Readonly<{
  entries: FeedbackDto[];
  /** The validated `?status=` param; `undefined` (absent or unknown) is All. */
  status?: FeedbackStatus;
  /**
   * Kept in the signature because the page still passes it: the header carries only
   * the Settings control, so the inbox no longer renders a feedback entry of its
   * own. The prop goes when `apps/app/app/feedback/page.tsx` stops passing it.
   */
  submitFeedbackAction: (input: CreateFeedbackInput) => Promise<FeedbackSubmitResult>;
  setFeedbackStatusAction: (id: string, status: FeedbackStatus) => Promise<FeedbackSubmitResult>;
}>) {
  const visible =
    status === undefined ? entries : entries.filter((entry) => entry.status === status);

  const body = (() => {
    if (visible.length === 0) {
      // Only a non-empty inbox with an active filter can "match nothing"; an
      // empty inbox keeps the frozen copy (`SPEC-feedback-status` §4). The
      // label-less `Section` is the same body step a list group opens with, so the
      // box sits one `--s6` under the filter row rather than flush against it.
      if (entries.length > 0 && status !== undefined) {
        return (
          <Section>
            <EmptyState {...matchesNothingState(status)} />
          </Section>
        );
      }
      return (
        <Section>
          <EmptyState heading={EMPTY_HEADING} body={EMPTY_BODY} />
        </Section>
      );
    }

    const byApp = new Map<string, FeedbackDto[]>();
    for (const entry of visible) {
      const bucket = byApp.get(entry.app);
      if (bucket) bucket.push(entry);
      else byApp.set(entry.app, [entry]);
    }

    return orderedKeys([...byApp.keys()], APP_ORDER).map((app) => {
      const appEntries = byApp.get(app) ?? [];
      const byType = new Map<string, FeedbackDto[]>();
      for (const entry of appEntries) {
        const bucket = byType.get(entry.type);
        if (bucket) bucket.push(entry);
        else byType.set(entry.type, [entry]);
      }
      return (
        <Section key={app} label={APP_LABELS[app] ?? app} count={entryCountLabel(appEntries.length)}>
          {orderedKeys([...byType.keys()], TYPE_ORDER).map((type) => {
            const typeEntries = byType.get(type) ?? [];
            return (
              <Section key={type} headingLevel="h3" label={TYPE_LABELS[type] ?? type}>
                <List>
                  {typeEntries.map((entry) => (
                    <FeedbackRow
                      key={entry.id}
                      entry={entry}
                      setStatusAction={setFeedbackStatusAction}
                    />
                  ))}
                </List>
              </Section>
            );
          })}
        </Section>
      );
    });
  })();

  return (
    <ListShell
      title="Feedback"
      subtitle={INBOX_SUBTITLE}
      navTrailing={navActions('feedback')}
      filters={<StatusFilter status={status} />}
      body={body}
    />
  );
}
