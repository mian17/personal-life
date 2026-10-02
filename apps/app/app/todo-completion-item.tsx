import type { TodoCompletion } from '@life/shared';
import { dueDateLabel, ListItem } from '@life/ui';

/**
 * One logged completion occurrence in the Done section: a PLAIN `ListItem` row
 * (no strike, no toggle, no trash) linking to the live todo's edit screen. The
 * strike is reserved for live done-todo rows (`TodoItem`); this row is a
 * read-only record of the occurrence that was ticked, while the repeating
 * todo's next occurrence stays open in Overdue/Today.
 *
 * The row shows the DUE date the tick satisfied (`occurrence`), not the
 * completion/click timestamp (`completedAt`). `groupTodos` keeps only
 * completions whose todo still exists and repeats, so every row here carries a
 * real dated `occurrence` — never the `'~'` undated-one-off sentinel — and no
 * sentinel handling is needed.
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
          <span>{dueDateLabel(completion.occurrence, today)}</span>
          {completion.listName && <span>{completion.listName}</span>}
        </>
      }
    />
  );
}
