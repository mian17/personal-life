import { normalizeTagIds } from '../src/tag-usage';

describe('normalizeTagIds', () => {
  it('deduplicates preserving first-seen order, then sorts', () => {
    expect(normalizeTagIds([3, 1, 3, 2, 1])).toEqual([1, 2, 3]);
  });

  it('treats undefined as an empty association set', () => {
    expect(normalizeTagIds(undefined)).toEqual([]);
  });

  it('returns a new array rather than mutating the caller input', () => {
    const input = [2, 1];
    expect(normalizeTagIds(input)).toEqual([1, 2]);
    expect(input).toEqual([2, 1]);
  });

  it('handles a single id and an already-sorted set', () => {
    expect(normalizeTagIds([5])).toEqual([5]);
    expect(normalizeTagIds([1, 2, 3])).toEqual([1, 2, 3]);
  });
});
