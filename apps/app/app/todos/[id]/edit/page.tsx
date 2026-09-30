import { notFound } from 'next/navigation';
import { ApiError } from '@/lib/client';
import { getTodo, listLists } from '@/lib/todo-api';
import { listTags } from '@/lib/tags-api';
import { TodoEditor } from '../../../todo-editor';

export const dynamic = 'force-dynamic';

export default async function EditTodoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const todo = await getTodo(id).catch((error) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });

  const [lists, tags] = await Promise.all([listLists(), listTags()]);
  return (
    <TodoEditor
      todo={todo}
      lists={lists}
      availableTags={tags.map((tag) => ({ id: tag.id, name: tag.name }))}
    />
  );
}
