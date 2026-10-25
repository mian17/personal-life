'use client';

import type { TagOption } from '@life/ui';
import { TagManager } from '@life/ui';
import { createTagAction, deleteTagAction, renameTagAction } from './actions';

/**
 * The registry management surface, used from `/notes` and `/todos`. Every
 * mutation goes through the shared server actions, so a rename or delete here is
 * the single vocabulary and shows up in the other app immediately.
 */
export function TagManagerPanel({ tags }: Readonly<{ tags: TagOption[] }>) {
  return (
    <TagManager
      tags={tags}
      onCreate={(name) => void createTagAction(name)}
      onRename={(id, name) => void renameTagAction(id, name)}
      onDelete={(id) => void deleteTagAction(id)}
    />
  );
}
