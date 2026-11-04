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
import { submitFeedbackAction } from '@/app/feedback-actions';
import { SettingsBlock, SettingsRow, SettingsShell } from '@life/ui';
import NotesSettingsPage from '@/app/notes/settings/page';

const mockedListNoteTagUsage = listNoteTagUsage as jest.MockedFunction<typeof listNoteTagUsage>;
const mockedResolveTagUsage = resolveTagUsage as jest.MockedFunction<typeof resolveTagUsage>;

/** The page returns one shell element; its `children` are the Notes group the page owns. */
function shellChildren(page: any): any[] {
  const kids = page?.props?.children;
  if (kids == null) return [];
  return (Array.isArray(kids) ? kids : [kids]).flat();
}

function notesGroup(page: any): any {
  return shellChildren(page).find(
    (child) => child?.type === SettingsBlock && child.props.title === 'Notes',
  );
}

function notesRow(page: any, label: string): any {
  const kids = notesGroup(page)?.props?.children;
  return (Array.isArray(kids) ? kids : [kids]).find(
    (child: any) => child?.type === SettingsRow && child.props.label === label,
  );
}

/**
 * The `/notes/settings` screen: one `SettingsShell` carrying the shared Appearance,
 * Comfort and Support groups plus the closing line, with the Notes group (registry-fed
 * Tags row, Trash row) as its only app-specific child.
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

  it('composes one SettingsShell titled Settings, backed to /notes, wired to notes feedback', async () => {
    const page = (await NotesSettingsPage()) as any;

    expect(page.type).toBe(SettingsShell);
    expect(page.props.title).toBe('Settings');
    expect(page.props.backHref).toBe('/notes');
    expect(page.props.app).toBe('notes');
    expect(page.props.onSubmit).toBe(submitFeedbackAction);
  });

  it('passes the Notes group as the shell\'s only child', async () => {
    const page = await NotesSettingsPage();

    expect(shellChildren(page)).toHaveLength(1);
    expect(notesGroup(page)).toBeDefined();
  });

  it('renders no Eisenhower matrix row', async () => {
    const html = renderToStaticMarkup(await NotesSettingsPage());

    expect(html).not.toContain('Eisenhower matrix');
  });

  it('renders the four groups in reference order, backed to /notes', async () => {
    const html = renderToStaticMarkup(await NotesSettingsPage());

    const order = ['Appearance', 'Comfort', 'Notes', 'Support'].map((label) =>
      html.indexOf(`>${label}</h2>`),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain('href="/notes"');
    expect(html).toContain('Personal Life · prototype');
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
    expect(html).not.toContain('Larger text');
    expect(html).not.toContain('role="switch"');
  });

  it('links the Tags and Trash rows, dot-joining the registry names into the count pill', async () => {
    const page = await NotesSettingsPage();
    const html = renderToStaticMarkup(page);

    expect(notesRow(page, 'Tags').props.href).toBe('/notes/tags');
    expect(notesRow(page, 'Tags').props.description).toBe('home · work');
    expect(notesRow(page, 'Trash').props.href).toBe('/notes/trash');
    expect(html).toContain('home · work');
    expect(html).toContain('>2</span>');
    expect(html).toContain('Notes you deleted.');
    expect(mockedResolveTagUsage).toHaveBeenCalledWith(await mockedListNoteTagUsage.mock.results[0].value);
  });

  it('renders the feedback row as the dialog trigger', async () => {
    const html = renderToStaticMarkup(await NotesSettingsPage());

    expect(html).toContain('Send feedback');
    expect(html).toContain('Tell us what got in the way.');
  });
});
