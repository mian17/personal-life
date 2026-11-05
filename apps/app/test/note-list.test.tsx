import type { Note } from '@life/shared';
import { todayIso } from '@life/ui';
import { renderToStaticMarkup } from 'react-dom/server';
import { NoteList } from '../app/note-list';

/** A note written today at 08:14 local, so `formatNoteMeta` reads `Today, 08:14`. */
function note(overrides: Partial<Note> = {}): Note {
  const [year, month, day] = todayIso().split('-').map(Number);
  return {
    id: 'n1',
    body: 'Garden plans\nWater the roses',
    tagIds: [],
    createdAt: new Date(year, month - 1, day, 8, 14).toISOString(),
    updatedAt: new Date(year, month - 1, day, 8, 14).toISOString(),
    deletedAt: null,
    version: 0,
    ...overrides,
  };
}

const render = (notes: Note[], tagNames: Record<number, string> = {}, isFiltered = false) =>
  renderToStaticMarkup(<NoteList notes={notes} tagNames={tagNames} isFiltered={isFiltered} />);

/**
 * The recent-notes rows: the painted meta line (time plus the one tag the registry
 * resolves), the chevron-only trailing slot, and the empty state that replaces the list.
 */
describe('NoteList', () => {
  it('paints the time and the first tag name in the meta line', () => {
    expect(render([note({ tagIds: [1] })], { 1: 'garden' })).toContain('Today, 08:14 · garden');
  });

  it('paints no middot suffix when none of the row tags resolve', () => {
    const html = render([note({ tagIds: [7] })], { 1: 'garden' });
    expect(html).toContain('Today, 08:14<');
    expect(html).not.toContain(' · ');
  });

  it('falls through a detached first tag to the next one the registry resolves', () => {
    expect(render([note({ tagIds: [7, 2] })], { 2: 'work' })).toContain('Today, 08:14 · work');
  });

  it('ends the row in a chevron and no delete control', () => {
    const html = render([note()]);
    expect(html).toContain('href="/notes/n1"');
    expect(html).toContain('chevron-right');
    expect(html).not.toContain('Delete');
  });

  it('renders the unfiltered empty state for an account with no notes', () => {
    const html = render([]);
    expect(html).toContain('No notes yet.');
    expect(html).toContain('Tap + to write your first note.');
    expect(html).not.toContain('ui-list');
  });

  it('renders the filtered empty state when a narrowed page matches nothing', () => {
    const html = render([], {}, true);
    expect(html).toContain('Nothing matches.');
    expect(html).toContain('Clear the search or try something else.');
    expect(html).not.toContain('No notes yet.');
  });
});
