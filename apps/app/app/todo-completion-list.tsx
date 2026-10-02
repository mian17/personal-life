import type { TodoCompletion } from '@life/shared';
import { EmptyState, List, ListItem, dueDateLabel } from '@life/ui';

/**
 * The read-only Done-view log: one row per completion occurrence, each linking
 * to its todo's edit screen. No toggle, no delete — the log is a record, not a
 * control surface.
 */
export function TodoCompletionList({
  completions,
  today,
}: {
  completions: TodoCompletion[];
  today: string;
}) {
  if (completions.length === 0) {
    return <EmptyState heading="No completed todos" body="Completed tasks appear here." />;
  }

  return (
    <List>
      {completions.map((c) => (
        <ListItem
          key={c.id}
          href={`/todos/${c.todoId}/edit`}
          title={c.title}
          meta={
            <>
              <span>{dueDateLabel(c.completedAt, today)}</span>
              {c.listName && <span>{c.listName}</span>}
            </>
          }
        />
      ))}
    </List>
  );
}
