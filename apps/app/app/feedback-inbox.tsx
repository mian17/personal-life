import type { CreateFeedbackInput, FeedbackDto, FeedbackSubmitResult } from '@life/shared';
import { FEEDBACK_APPS } from '@life/shared';
import {
  EmptyState,
  FEEDBACK_TYPES,
  FeedbackNavItem,
  List,
  ListItem,
  ListShell,
  LocalTime,
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

/** Canonical ids first, unknown ids last (alphabetical). */
function orderedKeys(keys: string[], canonical: readonly string[]): string[] {
  const known = canonical.filter((key) => keys.includes(key));
  const unknown = keys.filter((key) => !canonical.includes(key)).sort();
  return [...known, ...unknown];
}

/**
 * The `/feedback` owner inbox (app glue, like `note-list.tsx`): it groups and
 * renders, it never fetches. Buckets preserve encounter order — the service
 * already returns newest-first, so stable bucketing keeps every group
 * newest-first without a re-sort. One row type: a plain `ListItem` (lesson 0018).
 */
export function FeedbackInbox({
  entries,
  submitFeedbackAction,
}: {
  entries: FeedbackDto[];
  submitFeedbackAction: (input: CreateFeedbackInput) => Promise<FeedbackSubmitResult>;
}) {
  const body = (() => {
    if (entries.length === 0) {
      return <EmptyState heading={EMPTY_HEADING} body={EMPTY_BODY} />;
    }

    const byApp = new Map<string, FeedbackDto[]>();
    for (const entry of entries) {
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
                      <ListItem
                        key={entry.id}
                        title={entry.description}
                        meta={<LocalTime dateTime={entry.createdAt} />}
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
      body={body}
    />
  );
}