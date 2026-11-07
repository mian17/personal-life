import type { FeedbackDto } from '@life/shared';

// The `/feedback` page is a thin server shell over two seams (the
// `routes-todos-trash.test.tsx` pattern): it fetches the whole owner list, then hands
// a validated status down. The wire layer is what gets mocked, so the real
// `listFeedback` cursor walk runs and a page boundary is exercised rather than
// assumed. The filter behaviour itself lives in the inbox suite.
jest.mock('@/lib/client', () => ({ callService: jest.fn() }));
jest.mock('@/app/feedback-actions', () => ({
  submitFeedbackAction: jest.fn(),
  setFeedbackStatusAction: jest.fn(),
}));

import { callService } from '@/lib/client';
import FeedbackPage from '@/app/feedback/page';

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

/** The page's only contract: a validated status plus the full list, untouched. */
describe('/feedback page wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCallService.mockResolvedValue(page([entry('a'), entry('b')]));
  });

  it('reads an absent status as All (undefined) and passes the full list down', async () => {
    const el = await FeedbackPage({ searchParams: Promise.resolve({}) });

    expect(el.props.status).toBeUndefined();
    expect(el.props.entries.map((e: FeedbackDto) => e.id)).toEqual(['a', 'b']);
  });

  it('passes a known status through', async () => {
    const el = await FeedbackPage({ searchParams: Promise.resolve({ status: 'done' }) });

    expect(el.props.status).toBe('done');
  });

  it('follows the cursor so the inbox still receives the whole owner list', async () => {
    mockCallService
      .mockResolvedValueOnce(page([entry('a')], 'page-2'))
      .mockResolvedValueOnce(page([entry('b')]));

    const el = await FeedbackPage({ searchParams: Promise.resolve({}) });

    expect(el.props.entries.map((e: FeedbackDto) => e.id)).toEqual(['a', 'b']);
    const paths = mockCallService.mock.calls.map((call) => call[1] as string);
    expect(paths).toEqual(['/api/feedback', '/api/feedback?cursor=page-2']);
  });

  it('reads an unknown status as All, so a hand-typed URL never hides everything', async () => {
    const el = await FeedbackPage({ searchParams: Promise.resolve({ status: 'nonsense' }) });

    expect(el.props.status).toBeUndefined();
  });
});
