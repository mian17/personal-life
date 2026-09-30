import { ArrowLeft } from 'lucide-react';
import { IconLink, NavBar, PageShell, PageTitle } from '@life/ui';
import { TagManagerSection } from '../../tag-manager-section';

export const dynamic = 'force-dynamic';

export default function TagsPage() {
  return (
    <PageShell>
      <NavBar
        leading={
          <IconLink href="/notes" label="Back">
            <ArrowLeft size={20} aria-hidden />
          </IconLink>
        }
      />

      <PageTitle>Tags</PageTitle>

      <TagManagerSection />
    </PageShell>
  );
}
