import type { FeedbackDto } from '@life/shared';

// The `/feedback` page is a thin server shell over two seams (the
// `routes-todos-trash.test.tsx` pattern): it fetches the list, then hands a
// validated status down. The filter behaviour itself lives in the inbox suite.
jest.mock('@/lib/feedback-api', () => ({
  listFeedback: jest.fn(),
}));
jest.mock('@/app/feedback-actions', () => ({
  submitFeedbackAction: jest.fn(),
  setFeedbackStatusAction: jest.fn(),
}));

import { listFeedback } from '@/lib/feedback-api';
import FeedbackPage from '@/app/feedback/page';

const mockedListFeedback = listFeedback as jest.MockedFunction<typeof listFeedback>;

function entry(id: string): FeedbackDto {
  return {
    id,
    app: 'notes',
    type: 'bug',
    title: id,
    description: `${id} body`,
    status: 'open',
    createdAt: '2026-10-03T00:00:00.000Z',
  };
}

/** The page's only contract: a validated status plus the full list, untouched. */
describe('/feedback page wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedListFeedback.mockResolvedValue([entry('a'), entry('b')]);
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

  it('reads an unknown status as All, so a hand-typed URL never hides everything', async () => {
    const el = await FeedbackPage({ searchParams: Promise.resolve({ status: 'nonsense' }) });

    expect(el.props.status).toBeUndefined();
  });
});
