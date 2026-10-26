import { decodeTagUsage, isTagUsageRow } from '../src/tag-usage';

describe('isTagUsageRow', () => {
  it('accepts integer id and non-negative integer count', () => {
    expect(isTagUsageRow({ tagId: 1, count: 0 })).toBe(true);
    expect(isTagUsageRow({ tagId: 7, count: 42 })).toBe(true);
  });

  it('rejects non-integer ids and counts', () => {
    expect(isTagUsageRow({ tagId: 1.5, count: 1 })).toBe(false);
    expect(isTagUsageRow({ tagId: 1, count: 1.5 })).toBe(false);
  });

  it('rejects string fields', () => {
    expect(isTagUsageRow({ tagId: '1', count: 1 } as never)).toBe(false);
    expect(isTagUsageRow({ tagId: 1, count: '1' } as never)).toBe(false);
  });

  it('rejects negative counts', () => {
    expect(isTagUsageRow({ tagId: 1, count: -1 })).toBe(false);
  });
});

describe('decodeTagUsage', () => {
  it('accepts a valid cached payload', () => {
    expect(decodeTagUsage([{ tagId: 1, count: 2 }])).toEqual([{ tagId: 1, count: 2 }]);
  });

  it('throws the canonical message on a non-array payload', () => {
    expect(() => decodeTagUsage({ tagId: 1, count: 1 })).toThrow('cache entry is not tag usage');
  });

  it('throws the canonical message on a malformed row', () => {
    expect(() => decodeTagUsage([{ tagId: 1, count: 'x' }])).toThrow(
      'cache entry is not tag usage',
    );
  });
});
