import { listLists } from '@/lib/todo-api';
import { Card } from '@life/ui';
import { ListManagerPanel } from './list-manager-panel';

/** Server wrapper for the `ListManager`, fetching todo-service lists. */
export async function ListManagerSection() {
  const lists = await listLists();
  return (
    <Card>
      <ListManagerPanel lists={lists} />
    </Card>
  );
}
