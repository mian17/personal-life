import 'server-only';
import type {
  CreateTodoInput,
  List,
  ListPage,
  PushSubscribeInput,
  TagUsage,
  Todo,
  TodoCompletionPage,
  TodoPage,
  UpdateTodoInput,
} from '@life/shared';
import { withQuery } from '@life/app-kit';
import { callService } from './client';

const TODO_API_URL = process.env.TODO_API_URL ?? 'http://127.0.0.1:3005';

function call<T>(path: string, init?: RequestInit): Promise<T> {
  return callService<T>(TODO_API_URL, path, init);
}

export interface TodoFilters {
  q?: string;
  listId?: string;
  tagId?: number;
  done?: boolean;
  dueBefore?: string;
  dueAfter?: string;
  limit?: number;
  cursor?: string;
}

/** `GET /api/todos` — cursor page; filters are applied in memory by the service. */
export function listTodos(filters: TodoFilters = {}): Promise<TodoPage> {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.listId !== undefined) params.set('listId', filters.listId);
  if (filters.tagId !== undefined) params.set('tagId', String(filters.tagId));
  if (filters.done !== undefined) params.set('done', String(filters.done));
  if (filters.dueBefore !== undefined) params.set('dueBefore', filters.dueBefore);
  if (filters.dueAfter !== undefined) params.set('dueAfter', filters.dueAfter);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.cursor !== undefined) params.set('cursor', filters.cursor);
  return call<TodoPage>(withQuery('/api/todos', params));
}

export function getTodo(id: string): Promise<Todo> {
  return call<Todo>(`/api/todos/${id}`);
}

/**
 * `GET /api/todos/tags` — the todo domain's usage surface
 * (`[{tagId, count}]`); names resolve through `tags-service`.
 */
export function listTodoTagUsage(): Promise<TagUsage[]> {
  return call<TagUsage[]>('/api/todos/tags');
}

/** `GET /api/todos/completions` — cursor page of the completion log, newest-first. */
export function listTodoCompletions(
  opts: { limit?: number; cursor?: string } = {},
): Promise<TodoCompletionPage> {
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.cursor !== undefined) params.set('cursor', opts.cursor);
  return call<TodoCompletionPage>(withQuery('/api/todos/completions', params));
}

export function createTodo(input: CreateTodoInput): Promise<Todo> {
  return call<Todo>('/api/todos', { method: 'POST', body: JSON.stringify(input) });
}

export function updateTodo(id: string, input: UpdateTodoInput): Promise<Todo> {
  return call<Todo>(`/api/todos/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteTodo(id: string): Promise<{ ok: true }> {
  return call<{ ok: true }>(`/api/todos/${id}`, { method: 'DELETE' });
}

/** `GET /api/todos/trash` — cursor page of the owner's soft-deleted todos. */
export function listTodoTrash(): Promise<TodoPage> {
  return call<TodoPage>('/api/todos/trash');
}

export function restoreTodo(id: string): Promise<Todo> {
  return call<Todo>(`/api/todos/${id}/restore`, { method: 'POST' });
}

export function deleteTodoPermanently(id: string): Promise<{ ok: true }> {
  return call<{ ok: true }>(`/api/todos/${id}/permanent`, { method: 'DELETE' });
}

export function emptyTodoTrash(): Promise<{ ok: true; count: number }> {
  return call<{ ok: true; count: number }>('/api/todos/trash', { method: 'DELETE' });
}

/**
 * `GET /api/lists?q=&limit=&cursor=` — one page of the owner's todo-local lists,
 * name-sorted, narrowed by an optional name substring.
 *
 * `q` is filtered by the service **after** the cache hit, so it never enters the
 * cache key: one cached entry serves every search variant (Contract 2 Rule 3).
 */
export function fetchListPage(
  opts: { q?: string; limit?: number; cursor?: string } = {},
): Promise<ListPage> {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.cursor !== undefined) params.set('cursor', opts.cursor);
  return call<ListPage>(withQuery('/api/lists', params));
}

/**
 * The owner's **whole** list vocabulary, walked page by page.
 *
 * Every caller needs all of it: the manager panel renames and re-defaults from the
 * full set, the matrix and the todo list group by list, and every editor's list
 * picker offers every list. One page would hide the lists past the boundary — an
 * item would lose its group or a picker would omit its list — so the walk is the
 * only correct read for a screen. `maxItems` is a safety bound, not an expected
 * size.
 */
export async function listLists(maxItems = 1000): Promise<List[]> {
  const collected: List[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchListPage({ cursor });
    collected.push(...page.lists);
    if (collected.length >= maxItems || !page.nextCursor) return collected.slice(0, maxItems);
    cursor = page.nextCursor;
  }
}

export function createList(name: string): Promise<List> {
  return call<List>('/api/lists', { method: 'POST', body: JSON.stringify({ name }) });
}

export function renameList(
  id: string,
  name: string,
  importantDefault: boolean | null,
  expectedVersion?: number,
): Promise<List> {
  return call<List>(`/api/lists/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      name,
      importantDefault,
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    }),
  });
}

/** `DELETE /api/lists/:id` — detach semantics; its todos survive with `listId` cleared. */
export function deleteList(id: string): Promise<{ ok: true }> {
  return call<{ ok: true }>(`/api/lists/${id}`, { method: 'DELETE' });
}

/** `GET /api/push/key` — the VAPID public key the browser subscribes with. */
export function getPushKey(): Promise<{ publicKey: string }> {
  return call<{ publicKey: string }>('/api/push/key');
}

/** `POST /api/push/subscribe` — upsert the caller's push subscription. */
export function subscribePush(input: PushSubscribeInput): Promise<{ ok: true }> {
  return call<{ ok: true }>('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** `DELETE /api/push/subscribe` — idempotent removal by endpoint. */
export function unsubscribePush(endpoint: string): Promise<{ ok: true }> {
  return call<{ ok: true }>('/api/push/subscribe', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint }),
  });
}
