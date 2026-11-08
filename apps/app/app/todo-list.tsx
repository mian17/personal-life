import type { List as TodoList } from '@life/shared';
import { EmptyState, List, Section, type TagOption } from '@life/ui';
import { rowToneOf } from '@/lib/matrix';
import type { TodoGroup } from '@/lib/todo-groups';
import { TodoItem } from './todo-item';

/**
 * The grouped `/todos` list: Overdue / Today / Done, each rendered only when
 * non-empty (a per-group empty state is noise while another group has content).
 * Order within a group is the service's stable order. Every row — including a
 * repeating todo's completed occurrence in Done — is one `TodoItem`, so Done is
 * a single row type (muted + struck), never a bespoke component.
 */
export function TodoList({
  groups,
  today,
  lists,
  availableTags,
}: Readonly<{
  groups: TodoGroup[];
  today: string;
  lists: TodoList[];
  availableTags: TagOption[];
}>) {
  const total = groups.reduce((count, group) => count + group.todos.length, 0);

  if (total === 0) {
    // Labelled or not, a section opens one token step down; the empty state takes the
    // page's rhythm from it instead of an ad-hoc margin. `autoHideStyles` stays inert
    // here: it only hides a section holding a `.ui-list` with no row.
    return (
      <Section>
        <EmptyState heading="No todos" body="Tap + to add your first todo." />
      </Section>
    );
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
                  tone={todo.done ? undefined : rowToneOf(todo, today)}
                />
              ))}
            </List>
          </Section>
        ),
      )}
    </>
  );
}
