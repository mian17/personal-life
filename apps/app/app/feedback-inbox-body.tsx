'use client';

import { useState } from 'react';
import type { FeedbackDto, FeedbackPage, FeedbackStatus, FeedbackSubmitResult } from '@life/shared';
import { FEEDBACK_APPS } from '@life/shared';
import {
  AlertBanner,
  EmptyState,
  feedbackStatusOption,
  FEEDBACK_TYPES,
  List,
  LoadMore,
  Section,
} from '@life/ui';
import { FeedbackRow } from './feedback-row';

const APP_LABELS: Record<string, string> = { notes: 'Notes', todos: 'Todos', meals: 'Meals', feedback: 'Feedback' };
const APP_ORDER = FEEDBACK_APPS;
const TYPE_ORDER = FEEDBACK_TYPES.map((t) => t.value);
const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  FEEDBACK_TYPES.map((t) => [t.value, t.label]),
);

const EMPTY_HEADING = 'No feedback yet.';
const EMPTY_BODY = 'Open Settings → Send feedback to write the first one.';

/** The one message a failed appended page raises; the rows already on screen stay. */
const LOAD_FAILURE = "Couldn't load more feedback. Try again.";

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
 * The body for the entries currently in hand: an empty state, or the app → type
 * section tree. It runs over the whole merged list on every render, so grouping is
 * derived from the entries present rather than accumulated page by page — an appended
 * entry joins its existing app and type section instead of opening a duplicate heading.
 */
function groupedBody(
  entries: FeedbackDto[],
  visible: FeedbackDto[],
  status: FeedbackStatus | undefined,
  setFeedbackStatusAction: (id: string, status: FeedbackStatus) => Promise<FeedbackSubmitResult>,
) {
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
}

/**
 * The inbox body as one client island (`SPEC-load-more`). Page 1 arrives
 * server-rendered — so the first screenful is exactly what it was, and every frozen
 * row locator still finds its row — and this holds only what more pages add: the
 * appended entries, the cursor they continue from, and the one message a failure
 * raises.
 *
 * The `status` filter keeps working across pages because it still narrows in render:
 * a page arrives unfiltered (filters never enter the cache key, Contract 2 Rule 3) and
 * every appended entry goes through the same predicate.
 */
export function FeedbackInboxBody({
  entries: firstPage,
  nextCursor: firstCursor,
  status,
  loadPage,
  setFeedbackStatusAction,
}: Readonly<{
  /** Page 1, server-rendered. */
  entries: FeedbackDto[];
  /** Where page 1 ends; `null` is the whole list, and no load-more control renders. */
  nextCursor: string | null;
  /** The validated `?status=` param; `undefined` (absent or unknown) is All. */
  status?: FeedbackStatus;
  /** Fetch the page after `cursor` — a server action, so the token never reaches the browser. */
  loadPage: (cursor: string) => Promise<FeedbackPage>;
  setFeedbackStatusAction: (id: string, status: FeedbackStatus) => Promise<FeedbackSubmitResult>;
}>) {
  const [appended, setAppended] = useState<FeedbackDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(firstCursor);
  const [failure, setFailure] = useState<string | null>(null);

  const entries = [...firstPage, ...appended];

  async function loadNextPage(): Promise<void> {
    if (cursor === null) return;
    try {
      const page = await loadPage(cursor);
      setAppended((current) => [...current, ...page.feedback]);
      setCursor(page.nextCursor);
      setFailure(null);
    } catch {
      // The rows on screen are still valid; only the next page failed. `LoadMore`
      // re-arms itself and this line says why nothing was added.
      setFailure(LOAD_FAILURE);
    }
  }

  const visible =
    status === undefined ? entries : entries.filter((entry) => entry.status === status);

  return (
    <>
      {failure != null && <AlertBanner>{failure}</AlertBanner>}
      {groupedBody(entries, visible, status, setFeedbackStatusAction)}
      {cursor !== null && (
        <Section>
          <LoadMore onLoadMore={loadNextPage} />
        </Section>
      )}
    </>
  );
}
