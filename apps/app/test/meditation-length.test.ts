/**
 * @jest-environment jsdom
 *
 * The length this browser remembers (`SPEC-meditation-app` §1): the round-trip, the values it
 * refuses, and a storage that throws. Every refusal returns `null` rather than a number, so the
 * stepper falls back to the stored plan and the sitting still starts.
 */
import { MEDITATION_LENGTH_KEY, readStoredLength, storeLength } from '@/lib/meditation-length';

beforeEach(() => {
  window.localStorage.clear();
});

describe('readStoredLength and storeLength', () => {
  it('round-trips the length it stored', () => {
    storeLength(23);

    expect(readStoredLength()).toBe(23);
  });

  it('reads a missing value as nothing remembered', () => {
    expect(readStoredLength()).toBeNull();
  });

  it('reads a non-numeric value as nothing remembered', () => {
    window.localStorage.setItem(MEDITATION_LENGTH_KEY, 'soon');

    expect(readStoredLength()).toBeNull();
  });

  it('reads zero and a negative length as nothing remembered', () => {
    for (const stored of ['0', '-15', '-1']) {
      window.localStorage.setItem(MEDITATION_LENGTH_KEY, stored);

      expect(readStoredLength()).toBeNull();
    }
  });

  it('survives a storage that throws on both reads and writes', () => {
    const refuse = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    const refuseWrite = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(() => storeLength(20)).not.toThrow();
    expect(readStoredLength()).toBeNull();

    refuse.mockRestore();
    refuseWrite.mockRestore();
  });
});
