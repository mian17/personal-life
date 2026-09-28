import { permanentRedirect } from 'next/navigation';

/**
 * Trash is a notes-app concern, so it lives under `/notes/trash`. The old
 * root-level URL permanently redirects there, so bookmarks keep working.
 */
export default function TrashRedirect() {
  permanentRedirect('/notes/trash');
}
