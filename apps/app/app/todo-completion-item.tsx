import type { TodoCompletion } from '@life/shared';
import { dueDateLabel, ListItem } from '@life/ui';

/**
 * One logged completion occurrence in the Done section: a PLAIN `ListItem` row
 * (no strike, no toggle, no trash) linking to the live todo's edit screen. The
 * strike is reserved for live done-todo rows (`TodoItem`); this row is a
 * read-only record of the occurrence that was ticked, while the repeating
 * todo's next occurrence stays open in Overdue/Today.
 */
export function CompletionItem({
  completion,
  today,
}: {
  completion: TodoCompletion;
  today: string;
}) {
  return (
    <ListItem
      href={`/todos/${completion.todoId}/edit`}
      title={completion.title}
      meta={
        <>
          <span>{dueDateLabel(completion.completedAt, today)}</span>
          {completion.listName && <span>{completion.listName}</span>}
        </>
      }
    />
  );
}
