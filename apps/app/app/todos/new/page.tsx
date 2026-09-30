import { listLists } from '@/lib/todo-api';
import { listTags } from '@/lib/tags-api';
import { TodoEditor } from '../../todo-editor';

export const dynamic = 'force-dynamic';

export default async function NewTodoPage() {
  const [lists, tags] = await Promise.all([listLists(), listTags()]);
  return (
    <TodoEditor
      lists={lists}
      availableTags={tags.map((tag) => ({ id: tag.id, name: tag.name }))}
    />
  );
}
