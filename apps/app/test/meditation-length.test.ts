/**
 * @jest-environment jsdom
 *
 * The length this browser remembers (`SPEC-meditation-app` §1): the round-trip through the cookie,
 * the values it refuses, and a browser that refuses cookies. Every refusal reads as `null` rather
 * than a number, so the stepper falls back to the stored plan and the sitting still starts.
 */
import { MEDITATION_LENGTH_KEY, parseStoredLength, storeLength } from '@/lib/meditation-length';

/** What the browser kept of the cookie this test last wrote, as a value or nothing. */
function remembered(): string | null {
  const entry = document.cookie
    .split('; ')
    .find((pair) => pair.startsWith(`${MEDITATION_LENGTH_KEY}=`));
  return entry === undefined ? null : entry.slice(MEDITATION_LENGTH_KEY.length + 1);
}

beforeEach(() => {
  document.cookie = `${MEDITATION_LENGTH_KEY}=;path=/;max-age=0`;
});

describe('storeLength and parseStoredLength', () => {
  it('round-trips the length it stored', () => {
    storeLength(23);

    expect(remembered()).toBe('23');
    expect(parseStoredLength(remembered())).toBe(23);
  });

  it('writes the cookie for a year, site-wide and lax, like the timezone cookie', () => {
    const attributes: string[] = [];
    const write = jest
      .spyOn(Document.prototype, 'cookie', 'set')
      .mockImplementation((value: string) => attributes.push(value));

    storeLength(23);

    expect(attributes).toEqual([
      `${MEDITATION_LENGTH_KEY}=23;path=/;max-age=31536000;samesite=lax`,
    ]);
    write.mockRestore();
  });

  it('reads a missing value as nothing remembered', () => {
    expect(remembered()).toBeNull();
    expect(parseStoredLength(null)).toBeNull();
  });

  it('reads a non-numeric value as nothing remembered', () => {
    expect(parseStoredLength('soon')).toBeNull();
  });

  it('reads zero and a negative length as nothing remembered', () => {
    for (const stored of ['0', '-15', '-1']) {
      expect(parseStoredLength(stored)).toBeNull();
    }
  });

  it('reads a fractional length as nothing remembered', () => {
    expect(parseStoredLength('15.5')).toBeNull();
  });

  it('survives a browser that throws when the cookie is written', () => {
    const refuse = jest.spyOn(Document.prototype, 'cookie', 'set').mockImplementation(() => {
      throw new Error('cookies refused');
    });

    expect(() => storeLength(20)).not.toThrow();

    refuse.mockRestore();
  });
});
