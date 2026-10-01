import { notFound } from 'next/navigation';
import { ListShell, List, MatrixBlock, Tab, TabBar, todayIso } from '@life/ui';
import { Plus } from 'lucide-react';
import { readPref } from '@/lib/preferences';
import { listTodos, listLists } from '@/lib/todo-api';
import { collectTodos } from '@/lib/todo-query';
import { groupByQuadrant } from '@/lib/matrix';
import { TodoItem } from '../../todo-item';

export const dynamic = 'force-dynamic';

export default async function TodosMatrixPage() {
  if (!(await readPref('matrix'))) notFound();

  const [todos, lists] = await Promise.all([
    collectTodos((cursor) => listTodos({ cursor })),
    listLists(),
  ]);
  const today = todayIso();

  const quadrants = groupByQuadrant(todos, today).map((bucket) => ({
    id: bucket.id,
    label: bucket.label,
    items: (
      <List>
        {bucket.todos.map((todo) => (
          <TodoItem key={todo.id} todo={todo} today={today} lists={lists} availableTags={[]} />
        ))}
      </List>
    ),
  }));

  return (
    <ListShell
      title="Todos"
      tabs={
        <TabBar aria-label="Todos views">
          <Tab href="/todos">List</Tab>
          <Tab href="/todos/matrix" active>
            Matrix
          </Tab>
        </TabBar>
      }
      body={<MatrixBlock quadrants={quadrants} />}
      fabHref="/todos/new"
      fabLabel="New todo"
      fabIcon={<Plus size={28} strokeWidth={2.5} aria-hidden />}
    />
  );
}
