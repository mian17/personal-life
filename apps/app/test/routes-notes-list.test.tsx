import type { Note } from '@life/shared';
import { ListShell } from '@life/ui';
import { renderToStaticMarkup } from 'react-dom/server';

// The page's two backend seams. The tag surface stays empty so name resolution never
// leaves the process, and the list itself is mocked so page 1 and its cursor are
// explicit. `@life/app-kit`'s barrel reaches `next/headers`; nothing here renders the
// shell that uses it, so only the island's own markup is rendered.
jest.mock('@/lib/api', () => ({
  listNotes: jest.fn(),
  listNoteTagUsage: jest.fn(),
}));

import { listNotes, listNoteTagUsage } from '@/lib/api';
import NotesPage from '@/app/notes/page';
import { NoteListScroll } from '@/app/notes/note-list-scroll';

const mockedListNotes = listNotes as jest.MockedFunction<typeof listNotes>;
const mockedListNoteTagUsage = listNoteTagUsage as jest.MockedFunction<typeof listNoteTagUsage>;

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    body: 'Garden plans\nWater the roses',
    tagIds: [],
    createdAt: '2026-10-01T08:14:00.000Z',
    updatedAt: '2026-10-01T08:14:00.000Z',
    deletedAt: null,
    version: 0,
    ...overrides,
  };
}

/**
 * One page of the `{ notes, nextCursor, total }` envelope the service returns. `total`
 * is the whole set the page was sliced from, so it stays the note count even when the
 * cursor says more pages follow.
 */
function page(notes: Note[], nextCursor: string | null = null, total = notes.length) {
  return { notes, nextCursor, total };
}

function loadNotesPage(searchParams: { tag?: string; q?: string } = {}) {
  return NotesPage({ searchParams: Promise.resolve(searchParams) });
}

/**
 * The body island's markup. Page 1 is server-rendered by the page, so the island is what
 * an assertion about rows, the empty states and the load-more control reads — the shell
 * around it (header, search box, filter row) is unchanged by paging.
 */
async function renderBody(searchParams: { tag?: string; q?: string } = {}): Promise<string> {
  const el = await loadNotesPage(searchParams);
  return renderToStaticMarkup(el.props.body);
}

/** The page's contract: page 1 read on the server, its cursor handed to the island. */
describe('/notes page wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedListNoteTagUsage.mockResolvedValue([]);
    mockedListNotes.mockResolvedValue(page([note()]));
  });

  it('reads exactly page 1 on the server, carrying the tag filter and the query', async () => {
    await loadNotesPage({ tag: '7', q: 'roses' });

    // One request: the rest of the list is the island's job, by cursor.
    expect(mockedListNotes).toHaveBeenCalledTimes(1);
    expect(mockedListNotes).toHaveBeenCalledWith(7, 'roses');
  });

  it('hands page 1 and the cursor that continues it down to the island', async () => {
    mockedListNotes.mockResolvedValue(page([note()], 'cursor-2'));

    const el = await loadNotesPage();

    expect(el.props.body.type).toBe(NoteListScroll);
    expect(el.props.body.props.notes.map((n: Note) => n.id)).toEqual(['n1']);
    expect(el.props.body.props.nextCursor).toBe('cursor-2');
  });

  it('reports an exhausted list as a null cursor', async () => {
    const el = await loadNotesPage();

    expect(el.props.body.props.nextCursor).toBeNull();
  });

  it('keys the island on the active filter, so a changed one remounts page 1', async () => {
    const unfiltered = await loadNotesPage();
    const filtered = await loadNotesPage({ tag: '7', q: 'roses' });

    // A remount is the reset: the old cursor can never continue the new result set.
    expect(unfiltered.props.body.key).not.toBe(filtered.props.body.key);
  });

  it('server-renders the page-1 rows inside the Recent group', async () => {
    const html = await renderBody();

    expect(html).toContain('href="/notes/n1"');
    expect(html).toContain('Garden plans');
    expect(html).toContain('>Recent<');
    expect(html).toContain('1 note');
    expect(html).toContain('ui-list');
  });

  it('offers one load-more control while a next cursor exists', async () => {
    mockedListNotes.mockResolvedValue(page([note()], 'cursor-2'));

    const html = await renderBody();

    expect(html.match(/>Load more</g)).toHaveLength(1);
    // A real `Button` primitive: the focusable atom, not a div with a click handler.
    expect(html).toContain('ui-btn--ghost');
  });

  it('renders no load-more control once the list is exhausted', async () => {
    const html = await renderBody();

    expect(html).not.toContain('Load more');
  });

  it('keeps the unfiltered empty state for an account with no notes', async () => {
    mockedListNotes.mockResolvedValue(page([]));

    const html = await renderBody();

    expect(html).toContain('No notes yet.');
    expect(html).toContain('Tap + to write your first note.');
    expect(html).not.toContain('Load more');
  });

  it('keeps the filtered empty state when a narrowed page matches nothing', async () => {
    mockedListNotes.mockResolvedValue(page([]));

    const html = await renderBody({ q: 'nothing matches this' });

    expect(html).toContain('Nothing matches.');
    expect(html).toContain('Clear the search or try something else.');
    expect(html).not.toContain('No notes yet.');
  });
});
