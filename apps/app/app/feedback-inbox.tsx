'use client';

import { useState } from 'react';
import type { CreateFeedbackInput, FeedbackDto, FeedbackStatus, FeedbackSubmitResult } from '@life/shared';
import { FEEDBACK_APPS } from '@life/shared';
import {
  AlertBanner,
  EmptyState,
  feedbackStatusOption,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
  FeedbackNavItem,
  List,
  ListItem,
  ListShell,
  LocalTime,
  Pill,
  PillGroup,
  Select,
  Section,
} from '@life/ui';

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

/** The dropdown's choices: the same vocabulary, and the only place a `Select` needs building. */
const STATUS_OPTIONS = FEEDBACK_STATUSES.map(({ value, label }) => ({ value, label }));

/** What a failed status write says — the `submitFeedbackAction` failure contract, one string. */
const STATUS_FAILURE = "Couldn't update status. Try again.";

/**
 * The offline default for `setFeedbackStatusAction`: server-rendered rows get a
 * dropdown whose change resolves to the same result a failed write returns, so
 * no caller needs a null check and nothing posts from the server. Passing the
 * real action from the page replaces it — the app layer never branches on "is
 * there a seam".
 */
function noStatusAction(): Promise<FeedbackSubmitResult> {
  return Promise.resolve({ ok: false, message: STATUS_FAILURE });
}

/** Canonical ids first, unknown ids last (alphabetical). */
function orderedKeys(keys: string[], canonical: readonly string[]): string[] {
  const known = canonical.filter((key) => keys.includes(key));
  const unknown = keys.filter((key) => !canonical.includes(key)).sort();
  return [...known, ...unknown];
}

/**
 * The filter bar: All plus one pill per status — data straight from
 * `FEEDBACK_STATUSES`, so a vocabulary change rerenders here too. All is active
 * by default (`active === null`); each click filters in memory.
 */
function StatusFilter({
  active,
  onPick,
}: {
  active: FeedbackStatus | null;
  onPick: (status: FeedbackStatus | null) => void;
}) {
  return (
    <PillGroup label="Status">
      <Pill size="filter" as="button" active={active === null} onClick={() => onPick(null)}>
        All
      </Pill>
      {FEEDBACK_STATUSES.map(({ value, label }) => (
        <Pill
          key={value}
          size="filter"
          as="button"
          active={active === value}
          onClick={() => onPick(value)}
        >
          {label}
        </Pill>
      ))}
    </PillGroup>
  );
}

/**
 * One feedback row: the status pill rides the title line (`titleAction`) and the
 * status dropdown stacks beneath the text (`children`) — both are
 * `ListItem variant="feedback"` slots, so the app passes data, never markup. The
 * pill's status class is the vocabulary value; `atoms.css` maps it to the status's
 * semantic token, and `tokens.test.ts` pins that mapping against `tokens.css`.
 */
function FeedbackRow({
  entry,
  setStatusAction,
}: {
  entry: FeedbackDto;
  setStatusAction: (id: string, status: FeedbackStatus) => Promise<FeedbackSubmitResult>;
}) {
  const { label } = feedbackStatusOption(entry.status);
  /**
   * `picked` is the value in flight: while the write is pending the dropdown
   * shows the user's choice (`pickStatus` sets it synchronously); once the
   * seam answers we drop it so the dropdown follows the row's pill again (on
   * success via the re-rendered `entry.status`, on failure we keep the old
   * value and surface the failure message the seam documents).
   */
  const [picked, setPicked] = useState<FeedbackStatus | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  function pickStatus(status: FeedbackStatus) {
    setPicked(status);
    setFailure(null);
    void setStatusAction(entry.id, status).then((result) => {
      setPicked(null);
      if (!result.ok) {
        setFailure(result.message);
      }
    });
  }

  return (
    <ListItem
      variant="feedback"
      title={entry.title}
      snippet={entry.description}
      meta={<LocalTime dateTime={entry.createdAt} />}
      titleAction={
        <Pill className={`ui-pill--${entry.status}`} data-status={entry.status}>
          {label}
        </Pill>
      }
    >
      <Select
        aria-label={`Set status for ${entry.title}`}
        value={picked ?? entry.status}
        onChange={(event) => pickStatus(event.target.value as FeedbackStatus)}
        options={STATUS_OPTIONS}
      />
      {failure != null && <AlertBanner role="alert">{failure}</AlertBanner>}
    </ListItem>
  );
}

/**
 * The `/feedback` owner inbox (app glue, like `note-list.tsx`): it groups and
 * renders, it never fetches. The status filter narrows the rendered list in
 * memory (`null` = All); buckets preserve encounter order — the service already
 * returns newest-first, so stable bucketing keeps every group newest-first
 * without a re-sort. One row type: `ListItem variant="feedback"` (lesson 0018).
 */
export function FeedbackInbox({
  entries,
  submitFeedbackAction,
  setFeedbackStatusAction = noStatusAction,
}: {
  entries: FeedbackDto[];
  submitFeedbackAction: (input: CreateFeedbackInput) => Promise<FeedbackSubmitResult>;
  setFeedbackStatusAction?: (id: string, status: FeedbackStatus) => Promise<FeedbackSubmitResult>;
}) {
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | null>(null);
  const visible =
    statusFilter === null ? entries : entries.filter((entry) => entry.status === statusFilter);

  const body = (() => {
    if (visible.length === 0) {
      // Only a non-empty inbox with an active filter can "match nothing"; an
      // empty inbox keeps the frozen copy (`SPEC-feedback-status` §4).
      if (entries.length > 0 && statusFilter !== null) {
        return <EmptyState {...matchesNothingState(statusFilter)} />;
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
                {typeEntries.length === 0 ? (
                  <EmptyState heading={EMPTY_HEADING} body={EMPTY_BODY} />
                ) : (
                  <List>
                    {typeEntries.map((entry) => (
                      <FeedbackRow
                        key={entry.id}
                        entry={entry}
                        setStatusAction={setFeedbackStatusAction}
                      />
                    ))}
                  </List>
                )}
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
      navTrailing={<FeedbackNavItem app="feedback" onSubmit={submitFeedbackAction} />}
      filters={<StatusFilter active={statusFilter} onPick={setStatusFilter} />}
      body={body}
    />
  );
}