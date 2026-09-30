import { ArrowLeft } from 'lucide-react';
import { IconLink, NavBar, PageShell, PageTitle } from '@life/ui';
import { ListManagerSection } from '../../list-manager-section';

export const dynamic = 'force-dynamic';

export default function ListsPage() {
  return (
    <PageShell>
      <NavBar
        leading={
          <IconLink href="/todos" label="Back">
            <ArrowLeft size={20} aria-hidden />
          </IconLink>
        }
      />

      <PageTitle>Lists</PageTitle>

      <ListManagerSection />
    </PageShell>
  );
}
