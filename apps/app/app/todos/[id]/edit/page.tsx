import { loadOrNotFound } from '@life/app-kit';
import { getTodo, listLists } from '@/lib/todo-api';
import { listTags } from '@/lib/tags-api';
import { TodoEditor } from '../../../todo-editor';

export const dynamic = 'force-dynamic';

export default async function EditTodoPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;

  const todo = await loadOrNotFound(() => getTodo(id));

  const [lists, tags] = await Promise.all([listLists(), listTags()]);
  return (
    <TodoEditor
      todo={todo}
      lists={lists}
      availableTags={tags.map((tag) => ({ id: tag.id, name: tag.name }))}
    />
  );
}
