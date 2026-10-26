import type { CreateFeedbackInput, FeedbackDto, FeedbackStatus, FeedbackSubmitResult } from '@life/shared';
import { FEEDBACK_APPS } from '@life/shared';
import {
  EmptyState,
  feedbackStatusOption,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
  FeedbackNavItem,
  IconLink,
  List,
  ListShell,
  Pill,
  PillGroup,
  Section,
} from '@life/ui';
import { filterHref, settingsHref } from '@life/app-kit';
import { Settings } from 'lucide-react';
import { FeedbackRow } from './feedback-row';

const APP_LABELS: Record<string, string> = { notes: 'Notes', todos: 'Todos', meals: 'Meals', feedback: 'Feedback' };
const APP_ORDER = FEEDBACK_APPS;
const TYPE_ORDER = FEEDBACK_TYPES.map((t) => t.value);
const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  FEEDBACK_TYPES.map((t) => [t.value, t.label]),
);

const EMPTY_HEADING = 'No feedback yet.';
const EMPTY_BODY = 'Use the feedback button in the toolbar to send the first one.';

/**
 * A filter that hides every entry is not an empty inbox (`SPEC-feedback-status`
 * §4): the frozen `EMPTY_*` strings stay for a genuinely empty list, and this
 * message names the active filter instead.
 */
function matchesNothingState(status: FeedbackStatus): { heading: string; body: string } {
  const { label } = feedbackStatusOption(status);
  return { heading: `No ${label} feedback.`, body: `Try another status or switch back to All.` };
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
 * The filter bar: All plus one pill per status — data straight from
 * `FEEDBACK_STATUSES`, so a vocabulary change rerenders here too. Each pill is a
 * navigation (the notes `TagFilterNav` shape): the filter lives in the URL
 * (`?status=done`; All drops the param), so the view is shareable and the server
 * renders the one the owner asked for.
 */
function StatusFilter({ status }: Readonly<{ status: FeedbackStatus | undefined }>) {
  return (
    <PillGroup label="Status">
      <Pill
        size="filter"
        as="a"
        href={filterHref({ path: '/feedback', overrides: { status: undefined } })}
        active={status === undefined}
      >
        All
      </Pill>
      {FEEDBACK_STATUSES.map(({ value, label }) => (
        <Pill
          key={value}
          size="filter"
          as="a"
          href={filterHref({ path: '/feedback', overrides: { status: value } })}
          active={status === value}
        >
          {label}
        </Pill>
      ))}
    </PillGroup>
  );
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
  submitFeedbackAction,
  setFeedbackStatusAction,
}: Readonly<{
  entries: FeedbackDto[];
  /** The validated `?status=` param; `undefined` (absent or unknown) is All. */
  status?: FeedbackStatus;
  submitFeedbackAction: (input: CreateFeedbackInput) => Promise<FeedbackSubmitResult>;
  setFeedbackStatusAction: (id: string, status: FeedbackStatus) => Promise<FeedbackSubmitResult>;
}>) {
  const visible =
    status === undefined ? entries : entries.filter((entry) => entry.status === status);

  const body = (() => {
    if (visible.length === 0) {
      // Only a non-empty inbox with an active filter can "match nothing"; an
      // empty inbox keeps the frozen copy (`SPEC-feedback-status` §4).
      if (entries.length > 0 && status !== undefined) {
        return <EmptyState {...matchesNothingState(status)} />;
      }
      return <EmptyState heading={EMPTY_HEADING} body={EMPTY_BODY} />;
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
        <Section key={app} label={APP_LABELS[app] ?? app}>
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
      navTrailing={
        <>
          <FeedbackNavItem app="feedback" onSubmit={submitFeedbackAction} />
          <IconLink href={settingsHref('/feedback')} label="Settings">
            <Settings size={20} aria-hidden />
          </IconLink>
        </>
      }
      filters={<StatusFilter status={status} />}
      body={body}
    />
  );
}
