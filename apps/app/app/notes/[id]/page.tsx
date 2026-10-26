import { loadOrNotFound } from '@life/app-kit';
import { getNote } from '@/lib/api';
import { listTags } from '@/lib/tags-api';
import { NoteEditor } from '../../note-editor';

export const dynamic = 'force-dynamic';

export default async function NotePage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const [note, tags] = await Promise.all([loadOrNotFound(() => getNote(id)), listTags()]);

  return (
    <NoteEditor
      note={note}
      availableTags={tags.map((tag) => ({ id: tag.id, name: tag.name }))}
    />
  );
}
