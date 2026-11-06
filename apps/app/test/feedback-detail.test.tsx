import type { FeedbackDto } from '@life/shared';
import { renderToStaticMarkup } from 'react-dom/server';

// The detail route is a thin server shell over two seams, the `routes-feedback-list`
// pattern: it reads the owner's list and picks the entry this URL names.
jest.mock('@/lib/feedback-api', () => ({ listFeedback: jest.fn() }));
jest.mock('next/navigation', () => ({
  // Faithful to Next's helper: it throws a value Next turns into the 404 page. The
  // marker is what a test can read, so the assertion proves the route 404s rather
  // than rendering an empty page.
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

import { listFeedback } from '@/lib/feedback-api';
import FeedbackDetailPage from '@/app/feedback/[id]/page';

const mockedListFeedback = listFeedback as jest.MockedFunction<typeof listFeedback>;

function entry(overrides: Partial<FeedbackDto>): FeedbackDto {
  return {
    id: 'entry-1',
    app: 'notes',
    type: 'bug_report',
    title: 'Dark mode flickers on cold load',
    description: 'The first paint after a reload is light, then the theme snaps in.',
    status: 'open',
    createdAt: '2026-10-03T00:00:00.000Z',
    ...overrides,
  };
}

/** The route's markup for one id, rendered the way Next renders a server page. */
async function markupFor(id: string): Promise<string> {
  return renderToStaticMarkup(await FeedbackDetailPage({ params: Promise.resolve({ id }) }));
}

describe('/feedback/[id] page wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedListFeedback.mockResolvedValue([entry({})]);
  });

  it('picks the entry this URL names, not the first row of the list', async () => {
    const other = entry({ id: 'entry-2', title: 'Other', description: 'A different description' });
    mockedListFeedback.mockResolvedValue([other, entry({})]);

    const html = await markupFor('entry-1');

    expect(html).toContain('Dark mode flickers on cold load');
    expect(html).not.toContain('A different description');
  });

  it('renders the full description, unclamped, under a real h1 carrying the title', async () => {
    const html = await markupFor('entry-1');

    expect(html).toContain('<h1 class="ui-page-title');
    expect(html).toContain('Dark mode flickers on cold load');
    // The submitted text in full — the inbox row is the surface that clamps it.
    expect(html).toContain('The first paint after a reload is light, then the theme snaps in.');
    expect(html).not.toContain('line-clamp');
    // The status pill and the back affordance, from the primitives that own them.
    expect(html).toContain('ui-pill');
    expect(html).toContain('href="/feedback"');
    expect(html).toContain('aria-label="Back"');
  });

  it('is read-only: the status dropdown stays with the row that owns its write path', async () => {
    expect(await markupFor('entry-1')).not.toContain('<select');
  });

  it('404s an id the owner does not have, instead of rendering an empty page', async () => {
    await expect(markupFor('missing')).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
