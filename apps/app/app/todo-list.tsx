import type { List as TodoList } from '@life/shared';
import { EmptyState, List, Section, type TagOption } from '@life/ui';
import type { TodoGroup } from '@/lib/todo-groups';
import { CompletionItem } from './todo-completion-item';
import { TodoItem } from './todo-item';

/**
 * The grouped `/todos` list: Overdue / Today / Done, each rendered only when
 * non-empty (a per-group empty state is noise while another group has content).
 * Order within a group is the service's stable order. The Done group also shows
 * a repeating todo's latest completed occurrence as a plain read-only row.
 */
export function TodoList({
  groups,
  today,
  lists,
  availableTags,
}: {
  groups: TodoGroup[];
  today: string;
  lists: TodoList[];
  availableTags: TagOption[];
}) {
  const total = groups.reduce(
    (count, group) => count + group.todos.length + (group.completions?.length ?? 0),
    0,
  );

  if (total === 0) {
    return <EmptyState heading="No todos" body="Tap + to add your first todo." />;
  }

  return (
    <>
      {groups.map((group) =>
        group.todos.length === 0 && (group.completions?.length ?? 0) === 0 ? null : (
          <Section key={group.key} label={group.label}>
            <List>
              {group.completions?.map((completion) => (
                <CompletionItem key={`c-${completion.id}`} completion={completion} today={today} />
              ))}
              {group.todos.map((todo) => (
                <TodoItem
                  key={todo.id}
                  todo={todo}
                  today={today}
                  lists={lists}
                  availableTags={availableTags}
                />
              ))}
            </List>
          </Section>
        ),
      )}
    </>
  );
}
