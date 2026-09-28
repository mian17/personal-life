import { retainedTagIds, resolveInlineTagIds, resolveTagUsage } from '@/lib/tags-compose';

jest.mock('@/lib/tags-api', () => ({
  createOrGetTag: jest.fn(),
  resolveTags: jest.fn(),
}));

import { createOrGetTag, resolveTags } from '@/lib/tags-api';

const createOrGet = createOrGetTag as jest.MockedFunction<typeof createOrGetTag>;
const resolve = resolveTags as jest.MockedFunction<typeof resolveTags>;

function registryTag(id: number, name: string) {
  return { id, name, version: 0, createdAt: '2026-09-01T00:00:00.000Z' };
}

describe('resolveTagUsage (name resolution batching)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('resolves the whole surface in ONE call and preserves order', async () => {
    resolve.mockResolvedValue([
      { id: 2, name: 'home' },
      { id: 1, name: 'errand' },
    ]);
    const named = await resolveTagUsage([
      { tagId: 1, count: 3 },
      { tagId: 2, count: 1 },
    ]);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith([1, 2]);
    expect(named).toEqual([
      { tagId: 1, count: 3, name: 'errand' },
      { tagId: 2, count: 1, name: 'home' },
    ]);
  });

  it('omits usage rows the registry no longer resolves (detach)', async () => {
    resolve.mockResolvedValue([{ id: 1, name: 'errand' }]);
    const named = await resolveTagUsage([
      { tagId: 1, count: 3 },
      { tagId: 99, count: 7 },
    ]);
    expect(named).toEqual([{ tagId: 1, count: 3, name: 'errand' }]);
  });

  it('dedupes ids before resolving', async () => {
    resolve.mockResolvedValue([{ id: 1, name: 'errand' }]);
    await resolveTagUsage([
      { tagId: 1, count: 1 },
      { tagId: 1, count: 1 },
    ]);
    expect(resolve).toHaveBeenCalledWith([1]);
  });

  it('makes no registry call for an empty surface', async () => {
    expect(await resolveTagUsage([])).toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('resolveInlineTagIds (create-or-get)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates-or-gets each unique name case-insensitively', async () => {
    createOrGet.mockImplementation(async (name) => registryTag(name.length, name));
    const ids = await resolveInlineTagIds(['errand', 'Errand', 'home']);
    expect(createOrGet).toHaveBeenCalledTimes(2);
    expect(createOrGet).toHaveBeenCalledWith('errand');
    expect(createOrGet).toHaveBeenCalledWith('home');
    expect(ids).toHaveLength(2);
  });
});

describe('retainedTagIds (detach exclusion at write)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps only ids the registry resolves, preserving input order', async () => {
    resolve.mockResolvedValue([{ id: 2, name: 'home' }]);
    expect(await retainedTagIds([2, 1, 2])).toEqual([2]);
    expect(resolve).toHaveBeenCalledWith([2, 1]);
  });

  it('drops every id when the registry resolves none', async () => {
    resolve.mockResolvedValue([]);
    expect(await retainedTagIds([5, 6])).toEqual([]);
  });

  it('makes no registry call for an empty input', async () => {
    expect(await retainedTagIds([])).toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('propagates a registry failure (fail closed, never write dangling ids)', async () => {
    resolve.mockRejectedValue(new Error('registry down'));
    await expect(retainedTagIds([1])).rejects.toThrow('registry down');
  });
});
