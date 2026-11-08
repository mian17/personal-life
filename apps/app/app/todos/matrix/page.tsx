import { notFound } from 'next/navigation';
import { ListShell, List, MatrixBlock, Tab, TabBar } from '@life/ui';
import { Plus } from 'lucide-react';
import { readPref } from '@/lib/preferences';
import { getToday } from '@/lib/today';
import { listTodos, listLists } from '@/lib/todo-api';
import { collectTodos } from '@/lib/todo-query';
import { groupByQuadrant } from '@/lib/matrix';
import { describeTodoCounts } from '@/lib/todo-groups';
import { TodoItem } from '../../todo-item';
import { TodosNav } from '../../todos-nav';

export const dynamic = 'force-dynamic';

export default async function TodosMatrixPage() {
  if (!(await readPref('matrix'))) notFound();

  const [todos, lists] = await Promise.all([
    collectTodos((cursor) => listTodos({ cursor })),
    listLists(),
  ]);
  const today = await getToday();

  const buckets = groupByQuadrant(todos, today);
  const quadrants = buckets.map((bucket) => ({
    id: bucket.id,
    label: bucket.label,
    tone: bucket.tone,
    items: bucket.todos.length ? (
      <List>
        {bucket.todos.map((todo) => (
          <TodoItem
            key={todo.id}
            todo={todo}
            today={today}
            lists={lists}
            availableTags={[]}
            size="dense"
            tone={bucket.rowTone ?? undefined}
          />
        ))}
      </List>
    ) : null,
    empty: 'No tasks',
  }));

  // The grid's own row set drives the header, so the two cannot disagree: `open` is what
  // the quadrants render, `done` is the completed rows this fetch carried (the grid hides
  // them, `/todos` lists them, so they only exist in the sub-line here).
  const subtitle = describeTodoCounts(
    buckets.flatMap((bucket) => bucket.todos),
    todos.filter((todo) => todo.done),
  );

  return (
    <ListShell
      title="Matrix"
      subtitle={subtitle}
      navTrailing={<TodosNav />}
      tabs={
        <TabBar aria-label="Todos views">
          <Tab href="/todos">Today</Tab>
          <Tab href="/todos/matrix" active>
            Matrix
          </Tab>
        </TabBar>
      }
      body={<MatrixBlock quadrants={quadrants} />}
      fabHref="/todos/new"
      fabLabel="New todo"
      fabIcon={<Plus size={28} strokeWidth={2.5} aria-hidden />}
      fill
    />
  );
}
