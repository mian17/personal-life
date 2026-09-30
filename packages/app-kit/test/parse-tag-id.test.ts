import { parseTagId } from '../src/parse-tag-id';

describe('parseTagId', () => {
  it('accepts non-negative integer strings', () => {
    expect(parseTagId('12')).toBe(12);
    expect(parseTagId('012')).toBe(12);
    expect(parseTagId('0')).toBe(0);
  });

  it('rejects absent, empty and non-integer values', () => {
    expect(parseTagId(undefined)).toBeUndefined();
    expect(parseTagId('')).toBeUndefined();
    expect(parseTagId('-1')).toBeUndefined();
    expect(parseTagId('1.5')).toBeUndefined();
    expect(parseTagId('1a')).toBeUndefined();
    expect(parseTagId('x')).toBeUndefined();
  });
});
