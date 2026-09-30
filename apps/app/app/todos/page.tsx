import { listTodoTagUsage, listTodos, listLists, type TodoFilters } from '@/lib/todo-api';
import { listTags } from '@/lib/tags-api';
import { resolveTagUsage } from '@/lib/tags-compose';
import { groupTodos } from '@/lib/todo-groups';
import { collectTodos } from '@/lib/todo-query';
import { TodoList } from '../todo-list';
import { TodoSearchBox } from '../todo-search-box';
import { ListManagerSection } from '../list-manager-section';
import { TagManagerSection } from '../tag-manager-section';
import {
  FabLink,
  IconLink,
  NavBar,
  PageShell,
  PageTitle,
  Pill,
  PillGroup,
  Section,
  TagFilterNav,
  ThemeToggle,
  todayIso,
} from '@life/ui';
import { Plus, StickyNote } from 'lucide-react';

export const dynamic = 'force-dynamic';

/** Build a `/todos` href carrying the current filters, overriding one axis. */
function todoHref(
  current: { q?: string; list?: string; tag?: string; done?: string },
  overrides: Partial<{ q?: string; list?: string; tag?: string; done?: string }>,
): string {
  const merged = { ...current, ...overrides };
  const params = new URLSearchParams();
  if (merged.q) params.set('q', merged.q);
  if (merged.list) params.set('list', merged.list);
  if (merged.tag) params.set('tag', merged.tag);
  if (merged.done) params.set('done', merged.done);
  const qs = params.toString();
  return qs ? `/todos?${qs}` : '/todos';
}

export default async function TodosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; list?: string; tag?: string; done?: string }>;
}) {
  const { q, list, tag, done } = await searchParams;
  const tagId = tag !== undefined && /^\d+$/.test(tag) ? Number(tag) : undefined;
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

  const tagFilterItems = [
    ...(tagId !== undefined
      ? [{ name: 'All tags', href: todoHref({ q, list, done }, { tag: undefined }), active: false }]
      : []),
    ...namedTags.map((t) => ({
      name: t.name,
      href: todoHref({ q, list, done }, { tag: String(t.tagId) }),
      active: tagId === t.tagId,
    })),
  ];

  const listFilterItems = [
    ...(list !== undefined
      ? [{ name: 'All lists', href: todoHref({ q, tag, done }, { list: undefined }), active: false }]
      : []),
    ...lists.map((l) => ({
      name: l.name,
      href: todoHref({ q, tag, done }, { list: l.id }),
      active: list === l.id,
    })),
  ];

  return (
    <PageShell>
      <NavBar
        trailing={
          <>
            <IconLink href="/notes" label="Notes">
              <StickyNote size={20} aria-hidden />
            </IconLink>
            <ThemeToggle />
          </>
        }
      />

      <PageTitle>Todos</PageTitle>

      <TodoSearchBox q={q} listId={list} tag={tag} done={done} />

      <PillGroup label="Status" aria-label="Status">
        <Pill
          as="a"
          size="filter"
          href={todoHref({ q, list, tag }, { done: undefined })}
          active={doneFilter === undefined}
        >
          All
        </Pill>
        <Pill
          as="a"
          size="filter"
          href={todoHref({ q, list, tag }, { done: 'false' })}
          active={doneFilter === false}
        >
          Open
        </Pill>
        <Pill
          as="a"
          size="filter"
          href={todoHref({ q, list, tag }, { done: 'true' })}
          active={doneFilter === true}
        >
          Done
        </Pill>
      </PillGroup>

      {namedTags.length > 0 && <TagFilterNav label="Tags" items={tagFilterItems} />}
      {lists.length > 0 && <TagFilterNav label="Lists" items={listFilterItems} />}

      <TodoList groups={groups} today={today} lists={lists} availableTags={availableTags} /> 

      <FabLink href="/todos/new" label="New todo">
        <Plus size={28} strokeWidth={2.5} aria-hidden />
      </FabLink>
    </PageShell>
  );
}
