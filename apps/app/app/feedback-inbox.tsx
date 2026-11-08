import type {
  CreateFeedbackInput,
  FeedbackDto,
  FeedbackPage,
  FeedbackStatus,
  FeedbackSubmitResult,
} from '@life/shared';
import { FEEDBACK_STATUSES, ListShell, TagFilterNav } from '@life/ui';
import { filterHref, navActions } from '@life/app-kit';
import { listFeedbackPage } from '@/lib/feedback-api';
import { FeedbackInboxBody } from './feedback-inbox-body';

/** §8's `.phead__sub`: the one line under the title saying what the inbox spans. */
const INBOX_SUBTITLE = 'Across all five modules';

/**
 * One screenful. The service's own default is the same 50 (`DEFAULT_PAGE_LIMIT`), stated
 * once here so the server's first page and the body's appended pages ask for one size.
 */
export const FEEDBACK_PAGE_SIZE = 50;

/**
 * The page after `cursor`. A server action, so the browser asks for entries and the
 * owner's token never leaves the server (the `callService` choke point). Module scope
 * because it needs nothing from the render: the page size and the fetcher are both
 * module-level facts.
 */
async function loadFeedbackPage(cursor: string): Promise<FeedbackPage> {
  'use server';
  return listFeedbackPage({ limit: FEEDBACK_PAGE_SIZE, cursor });
}

/**
 * The filter row: All plus one chip per status — data straight from
 * `FEEDBACK_STATUSES`, so a vocabulary change rerenders here too. It is the notes
 * index's `TagFilterNav` shape (one row of link chips, All pinned at the leading
 * edge): the filter lives in the URL (`?status=done`; All drops the param), so the
 * view is shareable and the server renders the one the owner asked for.
 */
function StatusFilter({ status }: Readonly<{ status: FeedbackStatus | undefined }>) {
  const allStatus = {
    name: 'All',
    href: filterHref({ path: '/feedback', overrides: { status: undefined } }),
    active: status === undefined,
  };
  const statusFilters = FEEDBACK_STATUSES.map(({ value, label }) => ({
    name: label,
    href: filterHref({ path: '/feedback', overrides: { status: value } }),
    active: status === value,
  }));

  return <TagFilterNav aria-label="Status" pinned={allStatus} items={statusFilters} />;
}

/**
 * The `/feedback` owner inbox (app glue, like `note-list.tsx`): it frames and names
 * the screen, it never fetches beyond page 1. The rows, their grouping and the
 * load-more control belong to `FeedbackInboxBody`, the one client island here, because
 * appending a page happens after first paint.
 *
 * Page 1 is read on the server so the first screenful is exactly what it was before
 * paging existed — every frozen row locator still finds its row on load. `nextCursor`
 * is where that page ends: `null` is the whole list, which is what the body reads to
 * decide whether a load-more control exists at all.
 *
 * The `status` filter narrows in render rather than in the query (Contract 2 Rule 3
 * keeps filters out of the cache key), so one page of entries serves every filter.
 */
export function FeedbackInbox({
  entries,
  nextCursor = null,
  status,
  submitFeedbackAction,
  setFeedbackStatusAction,
}: Readonly<{
  /** Page 1, server-rendered. */
  entries: FeedbackDto[];
  /** Where page 1 ends; `null` (or omitted) is the whole list. */
  nextCursor?: string | null;
  /** The validated `?status=` param; `undefined` (absent or unknown) is All. */
  status?: FeedbackStatus;
  /**
   * Kept in the signature because the page still passes it: the header carries only
   * the Settings control, so the inbox no longer renders a feedback entry of its
   * own. The prop goes when `apps/app/app/feedback/page.tsx` stops passing it.
   */
  submitFeedbackAction: (input: CreateFeedbackInput) => Promise<FeedbackSubmitResult>;
  setFeedbackStatusAction: (id: string, status: FeedbackStatus) => Promise<FeedbackSubmitResult>;
}>) {
  return (
    <ListShell
      title="Feedback"
      subtitle={INBOX_SUBTITLE}
      navTrailing={navActions('feedback')}
      filters={<StatusFilter status={status} />}
      body={
        <FeedbackInboxBody
          entries={entries}
          nextCursor={nextCursor}
          status={status}
          loadPage={loadFeedbackPage}
          setFeedbackStatusAction={setFeedbackStatusAction}
        />
      }
    />
  );
}
