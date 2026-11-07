import type { FeedbackDto } from '@life/shared';

// The `/feedback` page is a thin server shell over two seams (the
// `routes-todos-trash.test.tsx` pattern): it reads page 1 of the owner list and hands
// the cursor down, then a validated status. The wire layer is what gets mocked, so the
// real `listFeedbackPage` URL building runs and the `limit`/`cursor` query is
// exercised rather than assumed. The filter and paging behaviour live in the inbox suite.
jest.mock('@/lib/client', () => ({ callService: jest.fn() }));
jest.mock('@/app/feedback-actions', () => ({
  submitFeedbackAction: jest.fn(),
  setFeedbackStatusAction: jest.fn(),
}));

import { callService } from '@/lib/client';
import FeedbackPage from '@/app/feedback/page';
import { FEEDBACK_PAGE_SIZE } from '@/app/feedback-inbox';

const mockCallService = callService as unknown as jest.Mock;

function entry(id: string): FeedbackDto {
  return {
    id,
    app: 'notes',
    // A real `FEEDBACK_TYPE_VALUES` entry: the DTO types `type` as a plain string,
    // so a stray value like 'bug' would typecheck and render under a raw label.
    type: 'bug_report',
    title: id,
    description: `${id} body`,
    status: 'open',
    createdAt: '2026-10-03T00:00:00.000Z',
  };
}

/** One page of the `{ feedback, nextCursor }` envelope the service returns. */
function page(feedback: FeedbackDto[], nextCursor: string | null = null) {
  return { feedback, nextCursor };
}

/** The page's contract: a validated status, page 1, and the cursor that continues it. */
describe('/feedback page wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCallService.mockResolvedValue(page([entry('a'), entry('b')]));
  });

  it('reads an absent status as All (undefined) and passes page 1 down', async () => {
    const el = await FeedbackPage({ searchParams: Promise.resolve({}) });

    expect(el.props.status).toBeUndefined();
    expect(el.props.entries.map((e: FeedbackDto) => e.id)).toEqual(['a', 'b']);
  });

  it('passes a known status through', async () => {
    const el = await FeedbackPage({ searchParams: Promise.resolve({ status: 'done' }) });

    expect(el.props.status).toBe('done');
  });

  it('reads exactly one page, with the page size the body also asks for', async () => {
    mockCallService.mockResolvedValueOnce(page([entry('a')], 'page-2'));

    const el = await FeedbackPage({ searchParams: Promise.resolve({}) });

    // One request: the rest of the list is the client shell's job, by cursor.
    const paths = mockCallService.mock.calls.map((call) => call[1] as string);
    expect(paths).toEqual([`/api/feedback?limit=${FEEDBACK_PAGE_SIZE}`]);
    expect(el.props.entries.map((e: FeedbackDto) => e.id)).toEqual(['a']);
  });

  it('hands the page-1 cursor down, so the body can continue where it stopped', async () => {
    mockCallService.mockResolvedValueOnce(page([entry('a')], 'page-2'));

    const el = await FeedbackPage({ searchParams: Promise.resolve({}) });

    expect(el.props.nextCursor).toBe('page-2');
  });

  it('reports an exhausted list as a null cursor', async () => {
    mockCallService.mockResolvedValueOnce(page([entry('a')]));

    const el = await FeedbackPage({ searchParams: Promise.resolve({}) });

    expect(el.props.nextCursor).toBeNull();
  });

  it('reads an unknown status as All, so a hand-typed URL never hides everything', async () => {
    const el = await FeedbackPage({ searchParams: Promise.resolve({ status: 'nonsense' }) });

    expect(el.props.status).toBeUndefined();
  });
});
