import type { TodoCompletion } from '@life/shared';
import { Button, EmptyState, List, ListItem, dueDateLabel } from '@life/ui';
import { Undo2 } from 'lucide-react';
import { undoTodoCompletionAction } from './todo-actions';

/**
 * The Done-view log: one row per completion occurrence, each linking to its
 * todo's edit screen. Every task's newest occurrence (the log arrives
 * newest-first) carries an Undo control; older rows stay read-only — v1 undoes
 * the latest occurrence per task only.
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

  const seen = new Set<string>();

  return (
    <List>
      {completions.map((c) => {
        const undoable = !seen.has(c.todoId);
        seen.add(c.todoId);
        return (
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
            trailing={
              undoable ? (
                <form action={undoTodoCompletionAction.bind(null, c.todoId)}>
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon"
                    className="done-undo"
                    aria-label={`Undo completion of ${c.title}`}
                  >
                    <Undo2 size={18} aria-hidden />
                  </Button>
                </form>
              ) : undefined
            }
          />
        );
      })}
    </List>
  );
}
