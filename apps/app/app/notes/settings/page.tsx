import { listNoteTagUsage } from '@/lib/api';
import { resolveTagUsage } from '@/lib/tags-compose';
import { Pill, SettingsBlock, SettingsRow, SettingsShell } from '@life/ui';
import { submitFeedbackAction } from '../../feedback-actions';

// The Tags row reads the registry at render, so the page is per-request like the index.
export const dynamic = 'force-dynamic';

/**
 * The shell owns the shared Appearance, Comfort and Support groups plus the closing line; the
 * page supplies the one group it is about. The tag count is read here, at render, so the row
 * reports the registry as it stands.
 */
export default async function NotesSettingsPage() {
  const namedTags = await resolveTagUsage(await listNoteTagUsage());
  const tagNames = namedTags.map((tag) => tag.name);

  return (
    <SettingsShell
      title="Settings"
      backHref="/notes"
      app="notes"
      onSubmit={submitFeedbackAction}
    >
      <SettingsBlock title="Notes">
        <SettingsRow
          label="Tags"
          href="/notes/tags"
          description={tagNames.length > 0 ? tagNames.join(' · ') : undefined}
          control={<Pill>{tagNames.length}</Pill>}
        />
        <SettingsRow label="Trash" href="/notes/trash" description="Notes you deleted." />
      </SettingsBlock>
    </SettingsShell>
  );
}
