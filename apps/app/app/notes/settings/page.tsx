import { listNoteTagUsage } from '@/lib/api';
import { resolveTagUsage } from '@/lib/tags-compose';
import { FeedbackNavItem, ManagerBlock, Pill, SettingsBlock, SettingsRow, ThemeToggle } from '@life/ui';
import { submitFeedbackAction } from '../../feedback-actions';

// The Tags row reads the registry at render, so the page is per-request like the index.
export const dynamic = 'force-dynamic';

export default async function NotesSettingsPage() {
  const namedTags = await resolveTagUsage(await listNoteTagUsage());
  const tagNames = namedTags.map((tag) => tag.name);

  return (
    <ManagerBlock title="Settings" backHref="/notes">
      <SettingsBlock title="Appearance">
        <ThemeToggle inGroup />
      </SettingsBlock>

      <SettingsBlock title="Comfort">
        <SettingsRow
          label="Reduce motion"
          description="Follows the system setting."
          control={<Pill>System</Pill>}
        />
        <SettingsRow
          label="Larger text"
          description="Follows Dynamic Type."
          control={<Pill>System</Pill>}
        />
      </SettingsBlock>

      <SettingsBlock title="Notes">
        <SettingsRow
          label="Tags"
          href="/notes/tags"
          description={tagNames.length > 0 ? tagNames.join(' · ') : undefined}
          control={<Pill>{tagNames.length}</Pill>}
        />
        <SettingsRow label="Trash" href="/notes/trash" description="Notes you deleted." />
      </SettingsBlock>

      <SettingsBlock title="Support">
        <FeedbackNavItem app="notes" onSubmit={submitFeedbackAction} variant="row" />
      </SettingsBlock>
    </ManagerBlock>
  );
}
