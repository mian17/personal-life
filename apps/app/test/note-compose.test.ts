import type { Note } from '@life/shared';
import { ApiError } from '@/lib/api-error';

jest.mock('@/lib/api', () => ({
  createNote: jest.fn(),
  updateNote: jest.fn(),
}));
jest.mock('@/lib/tags-api', () => ({
  createOrGetTag: jest.fn(),
  resolveTags: jest.fn(),
}));

import { createNote, updateNote } from '@/lib/api';
import { createOrGetTag, resolveTags } from '@/lib/tags-api';
import { createNoteWithTags, updateNoteWithTags } from '@/lib/note-compose';

const mockedCreate = createNote as jest.MockedFunction<typeof createNote>;
const mockedUpdate = updateNote as jest.MockedFunction<typeof updateNote>;
const mockedCreateOrGet = createOrGetTag as jest.MockedFunction<typeof createOrGetTag>;
const mockedResolve = resolveTags as jest.MockedFunction<typeof resolveTags>;

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    body: 'hi',
    tagIds: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    deletedAt: null,
    version: 0,
    ...overrides,
  };
}

describe('createNoteWithTags (registry create-or-get → note create)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates the inline names then writes their ids with the note', async () => {
    mockedCreateOrGet.mockResolvedValue({
      id: 7,
      name: 'errand',
      version: 0,
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    mockedResolve.mockResolvedValue([{ id: 1, name: 'home' }]);
    mockedCreate.mockResolvedValue(note({ id: 'n9', tagIds: [1, 7], version: 0 }));

    const result = await createNoteWithTags('buy milk #errand', [1], ['errand']);

    expect(mockedCreateOrGet).toHaveBeenCalledWith('errand');
    expect(mockedCreate).toHaveBeenCalledWith({ body: 'buy milk #errand', tagIds: [1, 7] });
    expect(result).toEqual({ id: 'n9', version: 0, tagIds: [1, 7] });
  });

  it('excludes an attached id the registry no longer resolves (detach at write)', async () => {
    mockedCreateOrGet.mockResolvedValue({
      id: 3,
      name: 'new',
      version: 0,
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    mockedResolve.mockResolvedValue([]); // id 1 was deleted elsewhere
    mockedCreate.mockResolvedValue(note({ tagIds: [3] }));

    await createNoteWithTags('x #new', [1], ['new']);

    expect(mockedCreate).toHaveBeenCalledWith({ body: 'x #new', tagIds: [3] });
  });

  it('dedupes the union of attached ids and inline ids', async () => {
    mockedCreateOrGet.mockResolvedValue({
      id: 1,
      name: 'errand',
      version: 0,
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    mockedResolve.mockResolvedValue([{ id: 1, name: 'errand' }]);
    mockedCreate.mockResolvedValue(note({ tagIds: [1] }));

    await createNoteWithTags('x', [1], ['errand']);
    expect(mockedCreate).toHaveBeenCalledWith({ body: 'x', tagIds: [1] });
  });

  it('re-resolves once and retries when the note service 404s a deleted tag', async () => {
    mockedCreateOrGet.mockResolvedValue({
      id: 5,
      name: 'gone',
      version: 0,
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    mockedResolve.mockResolvedValue([]);
    mockedCreate
      .mockRejectedValueOnce(new ApiError(404, 'API 404 on /api/notes'))
      .mockResolvedValueOnce(note({ tagIds: [] }));

    const result = await createNoteWithTags('x #gone', [], ['gone']);

    expect(mockedCreate).toHaveBeenCalledTimes(2);
    expect(result.tagIds).toEqual([]);
  });

  it('propagates a non-404 failure without a retry', async () => {
    mockedCreateOrGet.mockResolvedValue({
      id: 5,
      name: 'x',
      version: 0,
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    mockedResolve.mockResolvedValue([]);
    mockedCreate.mockRejectedValue(new ApiError(500, 'API 500 on /api/notes'));

    await expect(createNoteWithTags('x #x', [], ['x'])).rejects.toThrow('API 500');
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });
});

describe('updateNoteWithTags', () => {
  beforeEach(() => jest.clearAllMocks());

  it('writes the resolved ids with expectedVersion preserved', async () => {
    mockedCreateOrGet.mockResolvedValue({
      id: 2,
      name: 'home',
      version: 0,
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    mockedResolve.mockResolvedValue([]);
    mockedUpdate.mockResolvedValue(note({ version: 5, tagIds: [2] }));

    const result = await updateNoteWithTags('n1', 'body #home', [], ['home'], 4);

    expect(mockedUpdate).toHaveBeenCalledWith('n1', { body: 'body #home', tagIds: [2], expectedVersion: 4 });
    expect(result.version).toBe(5);
  });

  it('hands a 409 straight back to the caller (no retry)', async () => {
    mockedCreateOrGet.mockResolvedValue({
      id: 2,
      name: 'home',
      version: 0,
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    mockedResolve.mockResolvedValue([]);
    mockedUpdate.mockRejectedValue(new ApiError(409, 'API 409 on /api/notes/n1'));

    await expect(updateNoteWithTags('n1', 'b #home', [], ['home'], 1)).rejects.toThrow('API 409');
    expect(mockedUpdate).toHaveBeenCalledTimes(1);
  });
});
