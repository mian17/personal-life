jest.mock('@/lib/client', () => ({ callService: jest.fn() }));

import { callService } from '@/lib/client';
import { fetchNoteTagUsagePage, listNoteTagUsage } from '@/lib/api';
import { fetchTagPage, listTags } from '@/lib/tags-api';
import { fetchListPage, listLists } from '@/lib/todo-api';

const mockCallService = callService as unknown as jest.Mock;

/** The upstream answers `pages` in order, each a `{ rows, nextCursor }` envelope. */
function upstreamPages(key: string, pages: Array<{ rows: unknown[]; nextCursor: string | null }>): void {
  for (const page of pages) {
    mockCallService.mockResolvedValueOnce({ [key]: page.rows, nextCursor: page.nextCursor });
  }
}

/** The paths the fetchers asked for, in call order. */
function requestedPaths(): string[] {
  return mockCallService.mock.calls.map((call) => String(call[1]));
}

beforeEach(() => {
  mockCallService.mockReset();
});

describe('listTags', () => {
  it('walks the envelope to exhaustion, so the picker sees every tag', async () => {
    upstreamPages('tags', [
      { rows: [{ id: 1, name: 'alpha', version: 0, createdAt: '2026-01-01T00:00:00.000Z' }], nextCursor: 'c1' },
      { rows: [{ id: 2, name: 'beta', version: 0, createdAt: '2026-01-01T00:00:00.000Z' }], nextCursor: null },
    ]);

    const tags = await listTags();

    expect(tags.map((tag) => tag.name)).toEqual(['alpha', 'beta']);
    // A single page would hide `beta` from every tag picker and manager panel.
    expect(requestedPaths()).toEqual(['/api/tags', '/api/tags?cursor=c1']);
  });
});

describe('fetchTagPage', () => {
  it('forwards the window as query parameters', async () => {
    upstreamPages('tags', [{ rows: [], nextCursor: null }]);

    await fetchTagPage({ limit: 20, cursor: 'c2' });

    expect(requestedPaths()).toEqual(['/api/tags?limit=20&cursor=c2']);
  });
});

describe('listNoteTagUsage', () => {
  it('walks the envelope to exhaustion, so the filter row sees every used tag', async () => {
    upstreamPages('tagUsages', [
      { rows: [{ tagId: 1, count: 2 }], nextCursor: 'c1' },
      { rows: [{ tagId: 9, count: 1 }], nextCursor: null },
    ]);

    const usage = await listNoteTagUsage();

    expect(usage).toEqual([
      { tagId: 1, count: 2 },
      { tagId: 9, count: 1 },
    ]);
    expect(requestedPaths()).toEqual(['/api/tags', '/api/tags?cursor=c1']);
  });
});

describe('fetchNoteTagUsagePage', () => {
  it('forwards the window as query parameters', async () => {
    upstreamPages('tagUsages', [{ rows: [], nextCursor: null }]);

    await fetchNoteTagUsagePage({ limit: 5 });

    expect(requestedPaths()).toEqual(['/api/tags?limit=5']);
  });
});

describe('listLists', () => {
  it('walks the envelope to exhaustion, so the manager panel sees every list', async () => {
    const list = { id: 'l1', name: 'Home', importantDefault: null, version: 0, createdAt: '2026-01-01T00:00:00.000Z' };
    upstreamPages('lists', [
      { rows: [list], nextCursor: 'c1' },
      { rows: [{ ...list, id: 'l2', name: 'Work' }], nextCursor: null },
    ]);

    const lists = await listLists();

    expect(lists.map((row) => row.name)).toEqual(['Home', 'Work']);
    expect(requestedPaths()).toEqual(['/api/lists', '/api/lists?cursor=c1']);
  });
});

describe('fetchListPage', () => {
  it('forwards the window as query parameters', async () => {
    upstreamPages('lists', [{ rows: [], nextCursor: null }]);

    await fetchListPage({ limit: 10, cursor: 'c3' });

    expect(requestedPaths()).toEqual(['/api/lists?limit=10&cursor=c3']);
  });
});
