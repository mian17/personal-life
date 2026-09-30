import { LocalTime, TrashBlock } from '@life/ui';
import { listTodoTrash } from '@/lib/todo-api';
import {
  deleteForeverTodoAction,
  emptyTodoTrashAction,
  restoreTodoAction,
} from '../../todo-actions';

export const dynamic = 'force-dynamic';

export default async function TrashPage() {
  const { todos } = await listTodoTrash();

  return (
    <TrashBlock
      title="Trash"
      backHref="/todos"
      items={todos.map((todo) => ({
        id: todo.id,
        title: todo.title,
        meta: todo.deletedAt ? <LocalTime dateTime={todo.deletedAt} /> : undefined,
        snippet: todo.note ?? undefined,
      }))}
      emptyMessage="Trash is empty."
      restoreAction={(id) => restoreTodoAction.bind(null, id)}
      deleteForeverAction={(id) => deleteForeverTodoAction.bind(null, id)}
      deleteForeverMessage={() => 'Delete this todo forever? This cannot be undone.'}
      emptyTrashAction={emptyTodoTrashAction}
      emptyTrashMessage="Permanently delete all todos in trash? This cannot be undone."
    />
  );
}
