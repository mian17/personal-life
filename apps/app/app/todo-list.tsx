import type { List as TodoList } from '@life/shared';
import { EmptyState, List, Section, type TagOption } from '@life/ui';
import type { TodoGroup } from '@/lib/todo-groups';
import { TodoItem } from './todo-item';

/**
 * The grouped `/todos` list: Overdue / Today / Later / No date, each rendered
 * only when non-empty (a per-group empty state is noise while another group has
 * content). Order within a group is the service's stable order.
 */
export function TodoList({
  groups,
  today,
  lists,
  availableTags,
  hideDone,
}: {
  groups: TodoGroup[];
  today: string;
  lists: TodoList[];
  availableTags: TagOption[];
  hideDone: boolean;
}) {
  const total = groups.reduce((count, group) => count + group.todos.length, 0);

  if (total === 0) {
    return <EmptyState heading="No todos" body="Tap + to add your first todo." />;
  }

  return (
    <>
      {groups.map((group) =>
        group.todos.length === 0 ? null : (
          <Section key={group.key} label={group.label}>
            <List>
              {group.todos.map((todo) => (
                <TodoItem
                  key={todo.id}
                  todo={todo}
                  today={today}
                  lists={lists}
                  availableTags={availableTags}
                  hideDone={hideDone}
                />
              ))}
            </List>
          </Section>
        ),
      )}
    </>
  );
}
