import { renderToStaticMarkup } from 'react-dom/server';

// The page reads the tag registry through the server-only barrels; mocking them
// keeps `next/headers`/fetch out of the node test env (same pattern as
// `routes-settings.test.tsx`'s `@/lib/preferences` stub).
jest.mock('@/lib/api', () => ({
  listNoteTagUsage: jest.fn(),
}));
jest.mock('@/lib/tags-compose', () => ({
  resolveTagUsage: jest.fn(),
}));
jest.mock('@/app/feedback-actions', () => ({
  submitFeedbackAction: jest.fn(),
}));

import { listNoteTagUsage } from '@/lib/api';
import { resolveTagUsage } from '@/lib/tags-compose';
import NotesSettingsPage from '@/app/notes/settings/page';

const mockedListNoteTagUsage = listNoteTagUsage as jest.MockedFunction<typeof listNoteTagUsage>;
const mockedResolveTagUsage = resolveTagUsage as jest.MockedFunction<typeof resolveTagUsage>;

/**
 * The `/notes/settings` screen: the four groups the reference draws, in order,
 * with the Appearance segment alone in its group (no Theme row label), the Tags
 * row fed by the registry, and the feedback row as the dialog's trigger.
 */
describe('/notes/settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedListNoteTagUsage.mockResolvedValue([
      { tagId: 1, count: 3 },
      { tagId: 2, count: 1 },
    ]);
    mockedResolveTagUsage.mockResolvedValue([
      { tagId: 1, count: 3, name: 'home' },
      { tagId: 2, count: 1, name: 'work' },
    ]);
  });

  it('renders the four groups in reference order, backed to /notes', async () => {
    const html = renderToStaticMarkup(await NotesSettingsPage());

    const order = ['Appearance', 'Comfort', 'Notes', 'Support'].map((label) =>
      html.indexOf(`>${label}</h2>`),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain('href="/notes"');
  });

  it('lays the appearance segment as one pressed group, with no row label', async () => {
    const html = renderToStaticMarkup(await NotesSettingsPage());

    expect(html).toContain('role="group" aria-label="Appearance"');
    for (const label of ['Light', 'Dark', 'System']) {
      expect(html).toContain(`>${label}</button>`);
    }
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).not.toContain('System, light, or dark.');
  });

  it('reports the Comfort settings rather than offering controls', async () => {
    const html = renderToStaticMarkup(await NotesSettingsPage());

    expect(html).toContain('Reduce motion');
    expect(html).toContain('Follows the system setting.');
    expect(html).toContain('Larger text');
    expect(html).toContain('Follows Dynamic Type.');
    expect(html).not.toContain('role="switch"');
  });

  it('links the Tags and Trash rows, dot-joining the registry names into the count pill', async () => {
    const html = renderToStaticMarkup(await NotesSettingsPage());

    expect(html).toContain('href="/notes/tags"');
    expect(html).toContain('home · work');
    expect(html).toContain('>2</span>');
    expect(html).toContain('href="/notes/trash"');
    expect(html).toContain('Notes you deleted.');
    expect(mockedResolveTagUsage).toHaveBeenCalledWith(await mockedListNoteTagUsage.mock.results[0].value);
  });

  it('renders the feedback row as the dialog trigger', async () => {
    const html = renderToStaticMarkup(await NotesSettingsPage());

    expect(html).toContain('Send feedback');
    expect(html).toContain('Tell us what got in the way.');
  });
});
