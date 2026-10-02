import { listTodos, listLists, listTodoCompletions } from '@/lib/todo-api';
import { listTags } from '@/lib/tags-api';
import { groupTodos } from '@/lib/todo-groups';
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
