import { listTodos, listLists, listTodoCompletions } from '@/lib/todo-api';
import { listTags } from '@/lib/tags-api';
import { groupTodos } from '@/lib/todo-groups';
import type { TodoGroup } from '@/lib/todo-groups';
import { collectTodos, collectTodoCompletions } from '@/lib/todo-query';
import { TodoList } from '../todo-list';
import {
  ListShell,
  Tab,
  TabBar,
} from '@life/ui';
import { Plus } from 'lucide-react';
import { readPref } from '@/lib/preferences';
import { getToday } from '@/lib/today';
import { TodosNav } from '../todos-nav';

export const dynamic = 'force-dynamic';

/**
 * §8's `.phead__sub` line for `/todos`: how many rows that day's list is showing, split into
 * still-open and already-done. Both numbers are group lengths of the very `groups` value the
 * body renders, so the header can never disagree with the list. The middle dot is the same
 * U+00B7 `formatDateMeta` uses; counts stay literal (no pluralisation), like the reference's
 * "3 open · 2 done".
 */
function describeTodosHeader(groups: TodoGroup[]): string {
  const openCount = groups
    .filter((group) => group.key !== 'done')
    .reduce((count, group) => count + group.todos.length, 0);
  const doneCount = groups.find((group) => group.key === 'done')?.todos.length ?? 0;
  return `${openCount} open · ${doneCount} done`;
}

export default async function TodosPage() {
  const [lists, registry, todos, completions] = await Promise.all([
    listLists(),
    listTags(),
    collectTodos((cursor) => listTodos({ cursor })),
    collectTodoCompletions((cursor) => listTodoCompletions({ cursor })),
  ]);
  const availableTags = registry.map((t) => ({ id: t.id, name: t.name }));
  const today = await getToday();
  const groups = groupTodos(todos, today, completions);
  const matrixEnabled = await readPref('matrix');

  return (
    <ListShell
      title="Today"
      subtitle={describeTodosHeader(groups)}
      navTrailing={<TodosNav />}
      tabs={
        matrixEnabled ? (
          <TabBar aria-label="Todos views">
            <Tab href="/todos" active>
              Today
            </Tab>
            <Tab href="/todos/matrix">Matrix</Tab>
          </TabBar>
        ) : undefined
      }
      body={
        <TodoList groups={groups} today={today} lists={lists} availableTags={availableTags} />
      }
      fabHref="/todos/new"
      fabLabel="New todo"
      fabIcon={<Plus size={28} strokeWidth={2.5} aria-hidden />}
    />
  );
}
