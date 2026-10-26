/**
 * The autosave drain is the editor's only write path, and its failure modes are
 * invisible to the markup suites (they render to a string, so no effect runs).
 * These cases drive `drainOnce` directly with ref cells and a stubbed fetch.
 */
import type { Note } from '@life/shared';
import { drainOnce, type DrainContext } from '@/app/note-editor';

const SERVER_NOTE = { id: 'n1', version: 7, body: 'server', tagIds: [1] } as unknown as Note;

type Harness = {
  ctx: DrainContext;
  fetch: jest.Mock;
  statuses: string[];
  selected: number[][];
  conflicts: Note[];
};

function harness(id: string | null = 'n1'): Harness {
  const statuses: string[] = [];
  const selected: number[][] = [];
  const conflicts: Note[] = [];
  const fetch = jest.fn();
  global.fetch = fetch as unknown as typeof global.fetch;
  (globalThis as unknown as { window: unknown }).window = {
    history: { replaceState: jest.fn() },
  };

  const ctx: DrainContext = {
    idRef: { current: id },
    bodyRef: { current: 'local' },
    selectedRef: { current: [1] },
    versionRef: { current: 7 },
    dirtyRef: { current: true },
    modeRef: { current: 'strict' },
    sentRef: { current: null },
    inFlightRef: { current: false },
    setSelectedIds: (ids) => selected.push(ids),
    setStatus: (status) => statuses.push(status),
    enterConflict: (note) => conflicts.push(note),
  };
  return { ctx, fetch, statuses, selected, conflicts };
}

function respond(status: number, body: unknown): { status: number; ok: boolean; json: () => Promise<unknown> } {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

test('a clean editor does not talk to the server', async () => {
  const h = harness();
  h.ctx.dirtyRef.current = false;

  expect(await drainOnce(h.ctx)).toBe(true);
  expect(h.fetch).not.toHaveBeenCalled();
});

test('an empty body on a new note settles clean without creating anything', async () => {
  const h = harness(null);
  h.ctx.bodyRef.current = '   ';

  expect(await drainOnce(h.ctx)).toBe(true);
  expect(h.ctx.dirtyRef.current).toBe(false);
  expect(h.fetch).not.toHaveBeenCalled();
});

test('an empty body on an existing note is an error, not a saved clear', async () => {
  const h = harness();
  h.ctx.bodyRef.current = '';

  expect(await drainOnce(h.ctx)).toBe(false);
  expect(h.ctx.dirtyRef.current).toBe(true);
  expect(h.statuses).toEqual(['error']);
  expect(h.fetch).not.toHaveBeenCalled();
});

test('a saved flush folds the server version in and clears the sent snapshot', async () => {
  const h = harness();
  h.fetch.mockResolvedValue(respond(200, { version: 9 }));

  expect(await drainOnce(h.ctx)).toBe(true);
  expect(h.ctx.versionRef.current).toBe(9);
  expect(h.ctx.sentRef.current).toBeNull();
  expect(h.ctx.inFlightRef.current).toBe(false);
  expect(h.statuses).toEqual(['saving', 'saved']);
});

test('an edit that lands during the request keeps the editor dirty', async () => {
  const h = harness();
  h.fetch.mockImplementation(async () => {
    h.ctx.bodyRef.current = 'typed while saving';
    return respond(200, { version: 9 });
  });

  expect(await drainOnce(h.ctx)).toBe(true);
  expect(h.ctx.dirtyRef.current).toBe(true);
  expect(h.statuses).toEqual(['saving']);
});

test('the tag ids the server persisted replace the local set', async () => {
  const h = harness();
  h.fetch.mockResolvedValue(respond(200, { version: 9, tagIds: [4, 5] }));

  await drainOnce(h.ctx);
  expect(h.ctx.selectedRef.current).toEqual([4, 5]);
  expect(h.selected).toEqual([[4, 5]]);
});

test('creating a note adopts the server id and rewrites the url without a router hop', async () => {
  const h = harness(null);
  h.fetch.mockResolvedValue(respond(200, { id: 'new1', version: 1 }));

  await drainOnce(h.ctx);
  expect(h.ctx.idRef.current).toBe('new1');
  expect((globalThis as unknown as { window: { history: { replaceState: jest.Mock } } }).window.history.replaceState).toHaveBeenCalledWith(null, '', '/notes/new1');
});

test('a create posts, a save patches with the version it read', async () => {
  const create = harness(null);
  create.fetch.mockResolvedValue(respond(200, { id: 'new1', version: 1 }));
  await drainOnce(create.ctx);
  const [createUrl, createInit] = create.fetch.mock.calls[0] as [string, RequestInit];
  expect(createUrl).toBe('/api/notes/flush');
  expect(createInit.method).toBe('POST');
  expect(JSON.parse(String(createInit.body))).not.toHaveProperty('expectedVersion');

  const save = harness();
  save.fetch.mockResolvedValue(respond(200, { version: 8 }));
  await drainOnce(save.ctx);
  const [saveUrl, saveInit] = save.fetch.mock.calls[0] as [string, RequestInit];
  expect(saveUrl).toBe('/api/notes/n1/flush');
  expect(saveInit.method).toBe('PATCH');
  expect(JSON.parse(String(saveInit.body))).toMatchObject({ expectedVersion: 7 });
});

test('a 409 hands the server note to the conflict prompt and keeps the local edit', async () => {
  const h = harness();
  h.fetch.mockResolvedValue(respond(409, { note: SERVER_NOTE }));

  expect(await drainOnce(h.ctx)).toBe(false);
  expect(h.conflicts).toEqual([SERVER_NOTE]);
  expect(h.ctx.dirtyRef.current).toBe(false);
});

test('a 409 whose body cannot be read is an ordinary failure', async () => {
  const h = harness();
  h.fetch.mockResolvedValue({ status: 409, ok: false, json: async () => Promise.reject(new Error('bad json')) });

  expect(await drainOnce(h.ctx)).toBe(false);
  expect(h.conflicts).toEqual([]);
  expect(h.statuses).toEqual(['saving', 'error']);
  expect(h.ctx.dirtyRef.current).toBe(true);
});

test('a rejected flush stays dirty for a later retry', async () => {
  const h = harness();
  h.fetch.mockResolvedValue(respond(500, {}));

  expect(await drainOnce(h.ctx)).toBe(false);
  expect(h.ctx.sentRef.current).toBeNull();
  expect(h.ctx.dirtyRef.current).toBe(true);
  expect(h.statuses).toEqual(['saving', 'error']);
});

test('a transport error is reported the same way as a failed flush', async () => {
  const h = harness();
  h.fetch.mockRejectedValue(new Error('offline'));

  expect(await drainOnce(h.ctx)).toBe(false);
  expect(h.statuses).toEqual(['saving', 'error']);
  expect(h.ctx.inFlightRef.current).toBe(false);
});
