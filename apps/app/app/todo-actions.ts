'use server';

import { revalidatePath } from 'next/cache';
import type { CreateTodoInput, PushSubscribeInput, UpdateTodoInput } from '@life/shared';
import {
  createTodo,
  deleteTodo,
  updateTodo,
  createList,
  deleteList,
  renameList,
  restoreTodo,
  deleteTodoPermanently,
  emptyTodoTrash,
  getPushKey,
  subscribePush,
  unsubscribePush,
} from '@/lib/todo-api';
import { retainedTagIds } from '@/lib/tags-compose';

/**
 * Todo + list server actions (BFF composition, MAP M4). Every todo write that
 * carries `tagIds` passes them through the registry's resolve first, so a tag
 * deleted in `/notes` is **excluded from the write** (kernel detach semantics) —
 * not merely hidden at render.
 */

function revalidateTodos() {
  revalidatePath('/todos');
  revalidatePath('/todos/matrix');
  revalidatePath('/todos/trash');
}

export async function createTodoAction(input: CreateTodoInput) {
  const tagIds = input.tagIds ? await retainedTagIds(input.tagIds) : undefined;
  await createTodo({ ...input, ...(tagIds ? { tagIds } : {}) });
  revalidateTodos();
}

export async function updateTodoAction(
  id: string,
  patch: UpdateTodoInput,
  expectedVersion?: number,
) {
  const next: UpdateTodoInput = { ...patch };
  if (patch.tagIds) {
    next.tagIds = await retainedTagIds(patch.tagIds);
  }
  await updateTodo(id, { ...next, ...(expectedVersion !== undefined ? { expectedVersion } : {}) });
  revalidateTodos();
}

export async function deleteTodoAction(id: string) {
  await deleteTodo(id);
  revalidateTodos();
}

export async function restoreTodoAction(id: string) {
  await restoreTodo(id);
  revalidateTodos();
}

export async function deleteForeverTodoAction(id: string) {
  await deleteTodoPermanently(id);
  revalidateTodos();
}

export async function emptyTodoTrashAction() {
  await emptyTodoTrash();
  revalidateTodos();
}

export async function createListAction(name: string) {
  await createList(name);
  revalidateTodos();
}

export async function renameListAction(
  id: string,
  name: string,
  importantDefault: boolean | null,
  expectedVersion?: number,
) {
  await renameList(id, name, importantDefault, expectedVersion);
  revalidateTodos();
}

export async function deleteListAction(id: string) {
  await deleteList(id);
  revalidateTodos();
}

/** Reads the VAPID key server-side; the browser client never imports `lib/todo-api.ts`. */
export async function getPushKeyAction(): Promise<{ publicKey: string }> {
  return getPushKey();
}

export async function subscribePushAction(input: PushSubscribeInput): Promise<{ ok: true }> {
  return subscribePush(input);
}

export async function unsubscribePushAction(endpoint: string): Promise<{ ok: true }> {
  return unsubscribePush(endpoint);
}
