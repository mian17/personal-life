import { ManagerBlock } from '@life/ui';
import { ListManagerSection } from '../../list-manager-section';

export const dynamic = 'force-dynamic';

export default function ListsPage() {
  return (
    <ManagerBlock title="Lists" backHref="/todos">
      <ListManagerSection />
    </ManagerBlock>
  );
}
