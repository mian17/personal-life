import { ManagerBlock } from '@life/ui';
import { TagManagerSection } from '../../tag-manager-section';

export const dynamic = 'force-dynamic';

export default function TagsPage() {
  return (
    <ManagerBlock title="Tags" backHref="/notes">
      <TagManagerSection />
    </ManagerBlock>
  );
}
