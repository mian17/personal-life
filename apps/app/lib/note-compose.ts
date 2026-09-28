import 'server-only';
import { ApiError } from './api-error';
import { createNote, updateNote } from './api';
import { resolveInlineTagIds, retainedTagIds } from './tags-compose';

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/**
 * The union of explicitly attached ids and inline-parsed names, with ids the
 * registry no longer resolves **excluded** (kernel detach semantics: a tag
 * deleted in the other app must not be written back). Resolved once per write; a
 * dangling id also falls away on the next edit.
 */
async function writeTagIds(attachedIds: number[], names: string[]): Promise<number[]> {
  const [created, live] = await Promise.all([
    resolveInlineTagIds(names),
    retainedTagIds(attachedIds),
  ]);
  return [...new Set([...live, ...created])];
}

/** The `tagIds` persisted on the note, as returned to the editor. */
export interface NoteFlushResult {
  id: string;
  version: number;
  tagIds: number[];
}

/**
 * Create a note: resolve the write's tag ids (create-or-get + detach exclusion),
 * then `POST /api/notes` carrying `tagIds`. A 404 means a referenced tag was
 * deleted between resolve and write; re-resolving once covers that race.
 */
export async function createNoteWithTags(
  body: string,
  attachedIds: number[],
  names: string[],
): Promise<NoteFlushResult> {
  try {
    const tagIds = await writeTagIds(attachedIds, names);
    const note = await createNote({ body, tagIds });
    return { id: note.id, version: note.version, tagIds: note.tagIds };
  } catch (error) {
    if (!isNotFound(error)) throw error;
    const tagIds = await writeTagIds(attachedIds, names);
    const note = await createNote({ body, tagIds });
    return { id: note.id, version: note.version, tagIds: note.tagIds };
  }
}

/**
 * Update a note with the same resolve-then-write composition, preserving
 * `expectedVersion` so a stale editor still 409s.
 */
export async function updateNoteWithTags(
  id: string,
  body: string,
  attachedIds: number[],
  names: string[],
  expectedVersion?: number,
): Promise<NoteFlushResult> {
  try {
    const tagIds = await writeTagIds(attachedIds, names);
    const note = await updateNote(id, { body, tagIds, expectedVersion });
    return { id: note.id, version: note.version, tagIds: note.tagIds };
  } catch (error) {
    if (!isNotFound(error)) throw error;
    const tagIds = await writeTagIds(attachedIds, names);
    const note = await updateNote(id, { body, tagIds, expectedVersion });
    return { id: note.id, version: note.version, tagIds: note.tagIds };
  }
}
