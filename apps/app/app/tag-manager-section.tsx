import { listTags } from '@/lib/tags-api';
import { Card } from '@life/ui';
import { TagManagerPanel } from './tag-manager-panel';

/**
 * Server wrapper that fetches the registry vocabulary and renders the shared
 * `TagManager`. Mounted on both `/notes` and `/todos`, backed by `tags-service`
 * exclusively — the single source of the vocabulary.
 */
export async function TagManagerSection() {
  const tags = await listTags();
  return (
    <Card>
      <TagManagerPanel tags={tags.map((tag) => ({ id: tag.id, name: tag.name }))} />
    </Card>
  );
}
