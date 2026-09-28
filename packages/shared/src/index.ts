export { likeMatch } from './like-match';
export { resolveDbPath } from './db-path';

/**
 * `TagRef` — the ecosystem tag vocabulary reference (`SPEC-service-kernel`).
 * note-service no longer owns tag names; it stores exactly the integer ids a
 * write carries (association-only `note_tag` rows). Names live solely in
 * `tags-service` and are resolved by the app (BFF composition, MAP M4).
 */
export interface TagRef {
  tagId: number;
}

/**
 * A domain's tag usage surface (`GET …/tags → [{tagId, count}]`): the used ids
 * plus how many of the owner's rows carry each. Ids and counts only — no names.
 */
export interface TagUsage {
  tagId: number;
  count: number;
}

export interface Note {
  id: string;
  body: string;
  tagIds: number[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  version: number;
}

export interface CreateNoteInput {
  body: string;
  tagIds?: number[];
}

export interface UpdateNoteInput {
  body?: string;
  tagIds?: number[];
  expectedVersion?: number;
}

export interface NotePage {
  notes: Note[];
  nextCursor: string | null;
}

export const NOTE_BODY_MAX = 20000;
export const TAG_NAME_MAX = 50;
