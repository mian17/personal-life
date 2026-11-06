import { notFound } from 'next/navigation';
import type { FeedbackDto } from '@life/shared';
import { Card, feedbackStatusOption, LocalTime, ManagerBlock, Pill, Stack } from '@life/ui';
import { listFeedback } from '@/lib/feedback-api';

export const dynamic = 'force-dynamic';

/**
 * One feedback entry, read-only: what the inbox row can only clamp.
 *
 * The row shows two lines of the description, so the whole submitted text needs a
 * surface of its own (audit M11). There is no `GET /api/feedback/:id` and this page
 * adds none: `listFeedback()` is already owner-scoped and cached, and it returns
 * every one of the owner's entries, so the entry is the one with this id. An id that
 * matches nothing is a 404 — the list is the whole of what the owner may read, so an
 * entry missing from it is not there to show.
 *
 * Read-only by design: the status dropdown lives with the row that owns its write
 * path, and this screen would only duplicate it. The status chip rides the meta line
 * beside the creation date, so the card below holds the description and nothing else.
 */
export default async function FeedbackDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const entry = await findEntry(id);
  const { label } = feedbackStatusOption(entry.status);

  return (
    <ManagerBlock
      title={entry.title}
      backHref="/feedback"
      sub={
        <>
          <LocalTime dateTime={entry.createdAt} /> · <Pill tone={entry.status}>{label}</Pill>
        </>
      }
    >
      <Card>
        <Stack gap="md">{entry.description}</Stack>
      </Card>
    </ManagerBlock>
  );
}

/** The entry this route names, or the 404 a missing id deserves. */
async function findEntry(id: string): Promise<FeedbackDto> {
  const entries = await listFeedback();
  const entry = entries.find((candidate) => candidate.id === id);
  if (entry == null) notFound();
  return entry;
}
