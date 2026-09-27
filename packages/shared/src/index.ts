export { likeMatch } from './like-match';
export { resolveDbPath } from './db-path';

export interface Tag {
  id: number;
  name: string;
}

export interface Note {
  id: string;
  body: string;
  tags: Tag[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  version: number;
}

export interface CreateNoteInput {
  body: string;
  tags?: string[];
}

export interface UpdateNoteInput {
  body?: string;
  tags?: string[];
  expectedVersion?: number;
}

export interface NotePage {
  notes: Note[];
  nextCursor: string | null;
}

export const NOTE_BODY_MAX = 20000;
export const TAG_NAME_MAX = 50;
