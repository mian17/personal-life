import { listTodoTagUsage, listTodos, listLists, type TodoFilters } from '@/lib/todo-api';
import { listTags } from '@/lib/tags-api';
import { resolveTagUsage } from '@/lib/tags-compose';
import { groupTodos } from '@/lib/todo-groups';
import { collectTodos } from '@/lib/todo-query';
import { TodoList } from '../todo-list';
import { filterHref, parseTagId, PreservingSearchBox } from '@life/app-kit';
import {
  ListShell,
  Pill,
  PillGroup,
  Tab,
  TabBar,
  TagFilterNav,
  todayIso,
} from '@life/ui';
import { Plus, StickyNote } from 'lucide-react';
import { readPref } from '@/lib/preferences';
import { TodosNav } from '../todos-nav';

export const dynamic = 'force-dynamic';

export default async function TodosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; list?: string; tag?: string; done?: string }>;
}) {
  const { q, list, tag, done } = await searchParams;
  const tagId = parseTagId(tag);
  const doneFilter = done === 'true' ? true : done === 'false' ? false : undefined;

  const filters: TodoFilters = { q, listId: list, tagId, done: doneFilter };
  const [todos, usage, lists, registry] = await Promise.all([
    collectTodos((cursor) => listTodos({ ...filters, cursor })),
    listTodoTagUsage(),
    listLists(),
    listTags(),
  ]);
  const namedTags = await resolveTagUsage(usage);
  const availableTags = registry.map((t) => ({ id: t.id, name: t.name }));
  const today = todayIso();
  const groups = groupTodos(todos, today);
  const matrixEnabled = await readPref('matrix');

  const tagFilterItems = [
    ...(tagId !== undefined
      ? [
          {
            name: 'All tags',
            href: filterHref({ path: '/todos', current: { q, list, done }, overrides: { tag: undefined } }),
            active: false,
          },
        ]
      : []),
    ...namedTags.map((t) => ({
      name: t.name,
      href: filterHref({ path: '/todos', current: { q, list, done }, overrides: { tag: String(t.tagId) } }),
      active: tagId === t.tagId,
    })),
  ];

  const listFilterItems = [
    ...(list !== undefined
      ? [
          {
            name: 'All lists',
            href: filterHref({ path: '/todos', current: { q, tag, done }, overrides: { list: undefined } }),
            active: false,
          },
        ]
      : []),
    ...lists.map((l) => ({
      name: l.name,
      href: filterHref({ path: '/todos', current: { q, tag, done }, overrides: { list: l.id } }),
      active: list === l.id,
    })),
  ];

  return (
    <ListShell
      title="Todos"
      navTrailing={<TodosNav />}
      tabs={
        matrixEnabled ? (
          <TabBar aria-label="Todos views">
            <Tab href="/todos" active>
              List
            </Tab>
            <Tab href="/todos/matrix">Matrix</Tab>
          </TabBar>
        ) : undefined
      }
      search={<PreservingSearchBox path="/todos" q={q} params={{ list, tag, done }} label="Search todos" />}
      filters={
        <>
          <PillGroup label="Status" aria-label="Status">
            <Pill
              as="a"
              size="filter"
              href={filterHref({ path: '/todos', current: { q, list, tag }, overrides: { done: undefined } })}
              active={doneFilter === undefined}
            >
              All
            </Pill>
            <Pill
              as="a"
              size="filter"
              href={filterHref({ path: '/todos', current: { q, list, tag }, overrides: { done: 'false' } })}
              active={doneFilter === false}
            >
              Open
            </Pill>
            <Pill
              as="a"
              size="filter"
              href={filterHref({ path: '/todos', current: { q, list, tag }, overrides: { done: 'true' } })}
              active={doneFilter === true}
            >
              Done
            </Pill>
          </PillGroup>

          {namedTags.length > 0 && <TagFilterNav label="Tags" items={tagFilterItems} />}
          {lists.length > 0 && <TagFilterNav label="Lists" items={listFilterItems} />}
        </>
      }
      body={<TodoList groups={groups} today={today} lists={lists} availableTags={availableTags} hideDone={doneFilter !== true} />}
      fabHref="/todos/new"
      fabLabel="New todo"
      fabIcon={<Plus size={28} strokeWidth={2.5} aria-hidden />}
    />
  );
}
