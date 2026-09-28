import { listTags } from '@/lib/tags-api';
import { NoteEditor } from '../../note-editor';

export const dynamic = 'force-dynamic';

export default async function NewNotePage() {
  const tags = await listTags();
  return <NoteEditor availableTags={tags.map((tag) => ({ id: tag.id, name: tag.name }))} />;
}
