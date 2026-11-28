/**
 * The interval bells: the fire times a schedule yields, the sheet's own offset and interval
 * arithmetic, the summary line it derives, and the scheduler that rings exactly those times
 * and nothing of its own.
 *
 * Every boundary in `SPEC-meditation-app` §6 is asserted at its edge value, and the
 * scheduler is proven against the function's own output rather than a re-derivation.
 */
import {
  OFFSET_MAX_SEC,
  bellsFrom,
  describeSchedule,
  draftFrom,
  formatOffset,
  intervalBellTimes,
  offsetFromParts,
  offsetParts,
  ringIntervalBells,
  stepInterval,
  stepOffset,
  type BellSchedule,
  type BellsDraft,
} from '@/lib/meditation-bells';

/** A quarter-hour offset, ten-minute interval, three bowls at most. */
const SAMPLE: BellSchedule = {
  durationSec: 3600,
  offsetSec: 300,
  intervalSec: 600,
  repeat: 3,
};

describe('intervalBellTimes', () => {
  it('returns absolute offset + n × interval times', () => {
    expect(intervalBellTimes(SAMPLE)).toEqual([300, 900, 1500]);
  });

  it('never accumulates drift across a long sitting', () => {
    const times = intervalBellTimes({
      durationSec: 7200,
      offsetSec: 90,
      intervalSec: 610,
      repeat: null,
    });

    expect(times).toEqual([90, 700, 1310, 1920, 2530, 3140, 3750, 4360, 4970, 5580, 6190, 6800]);
  });

  it('rings nothing when the offset is at or past the sitting end', () => {
    expect(intervalBellTimes({ ...SAMPLE, offsetSec: 3600 })).toEqual([]);
    expect(intervalBellTimes({ ...SAMPLE, offsetSec: 3601 })).toEqual([]);
  });

  it('rings to the end when the repeat is null', () => {
    const times = intervalBellTimes({
      durationSec: 3600,
      offsetSec: 600,
      intervalSec: 600,
      repeat: null,
    });

    expect(times).toEqual([600, 1200, 1800, 2400, 3000]);
  });

  it('rings at most the repeat count', () => {
    const times = intervalBellTimes({
      durationSec: 24 * 3600,
      offsetSec: 0,
      intervalSec: 10,
      repeat: 6,
    });

    expect(times).toHaveLength(6);
    expect(times.at(-1)).toBe(50);
  });

  it('drops a fire time at or past the sitting end', () => {
    const times = intervalBellTimes({
      durationSec: 1200,
      offsetSec: 0,
      intervalSec: 600,
      repeat: null,
    });

    expect(times).toEqual([0, 600]);
  });

  it('rings nothing for an interval that cannot advance', () => {
    expect(intervalBellTimes({ ...SAMPLE, intervalSec: 0 })).toEqual([]);
  });
});

describe('ringIntervalBells', () => {
  afterEach(() => {
    jest.useRealTimers();
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
  });

  it('rings only at the times intervalBellTimes returned', () => {
    const bells = recordBells();
    const schedule: BellSchedule = {
      durationSec: 1800,
      offsetSec: 300,
      intervalSec: 600,
      repeat: 2,
    };
    const stopRinging = ringIntervalBells(schedule);

    expect(intervalBellTimes(schedule)).toEqual([300, 900]);

    jest.advanceTimersByTime(299_999);
    expect(bells.rung).toBe(0);

    jest.advanceTimersByTime(1);
    expect(bells.rung).toBe(1);

    jest.advanceTimersByTime(599_999);
    expect(bells.rung).toBe(1);

    jest.advanceTimersByTime(1);
    expect(bells.rung).toBe(2);

    jest.advanceTimersByTime(1800 * 1000);
    expect(bells.rung).toBe(2);

    stopRinging();
  });

  it('silences the bells still pending when the sitting stops', () => {
    const bells = recordBells();
    const stopRinging = ringIntervalBells(SAMPLE);

    jest.advanceTimersByTime(600 * 1000);
    expect(bells.rung).toBe(1);

    stopRinging();
    jest.advanceTimersByTime(3600 * 1000);
    expect(bells.rung).toBe(1);
  });

  it('rings nothing and throws nothing without Web Audio', () => {
    jest.useFakeTimers();

    const stopRinging = ringIntervalBells(SAMPLE);

    expect(() => jest.advanceTimersByTime(3600 * 1000)).not.toThrow();

    stopRinging();
  });
});

/** A stub Web Audio that counts how many bells actually sounded. */
function recordBells(): { rung: number } {
  jest.useFakeTimers();

  const bells = { rung: 0 };

  class CountingOscillator {
    frequency = { value: 0 };
    onended: (() => void) | null = null;

    connect(): void {
      return undefined;
    }

    start(): void {
      bells.rung += 1;
    }

    stop(): void {}
  }

  class CountingAudioContext {
    currentTime = 0;
    destination = {};

    createOscillator(): CountingOscillator {
      return new CountingOscillator();
    }

    close(): Promise<void> {
      return Promise.resolve();
    }
  }

  (globalThis as { AudioContext?: unknown }).AudioContext = CountingAudioContext;

  return bells;
}

describe('the offset the sheet edits', () => {
  it('splits seconds into the three fields and back without losing one', () => {
    expect(offsetParts(3661)).toEqual({ hours: 1, minutes: 1, seconds: 1 });
    expect(offsetParts(OFFSET_MAX_SEC)).toEqual({ hours: 23, minutes: 59, seconds: 59 });
    expect(offsetFromParts({ hours: 1, minutes: 1, seconds: 1 })).toBe(3661);
    expect(offsetFromParts({ hours: 23, minutes: 59, seconds: 59 })).toBe(OFFSET_MAX_SEC);
  });

  it('clamps each part to its own bound before it can roll the one above it', () => {
    expect(offsetFromParts({ hours: 0, minutes: 90, seconds: 0 })).toBe(59 * 60);
    expect(offsetFromParts({ hours: 0, minutes: 0, seconds: 90 })).toBe(59);
    expect(offsetFromParts({ hours: 24, minutes: 0, seconds: 0 })).toBe(23 * 3600);
  });

  it('steps a whole minute and stops at both ends of the day', () => {
    expect(stepOffset(0, 1)).toBe(60);
    expect(stepOffset(0, -1)).toBe(0);
    expect(stepOffset(30, -1)).toBe(0);
    expect(stepOffset(86340, 1)).toBe(OFFSET_MAX_SEC);
    expect(stepOffset(OFFSET_MAX_SEC, 1)).toBe(OFFSET_MAX_SEC);
  });

  it('reads the offset in words, never as a clock', () => {
    expect(formatOffset(0)).toBe('0 min');
    expect(formatOffset(60)).toBe('1 min');
    expect(formatOffset(90)).toBe('1 min 30 sec');
    expect(formatOffset(3599)).toBe('59 min 59 sec');
    expect(formatOffset(7200)).toBe('2 h');
    expect(formatOffset(3661)).toBe('1 h 1 min 1 sec');
  });
});

describe('the interval the sheet steps', () => {
  it('moves in whole ten-minute steps over 10 minutes to a day', () => {
    expect(stepInterval(10, 1)).toBe(20);
    expect(stepInterval(20, -1)).toBe(10);
    expect(stepInterval(1430, 1)).toBe(1440);
  });

  it('clamps at both ends of the service grid instead of leaving it', () => {
    expect(stepInterval(10, -1)).toBe(10);
    expect(stepInterval(1440, 1)).toBe(1440);
  });
});

describe('the draft and the stored bells', () => {
  it('reads minutes out of the stored seconds, and puts them back at the save boundary', () => {
    const stored = { enabled: true, offsetSec: 300, intervalSec: 1200, repeat: 3 };

    expect(draftFrom(stored)).toEqual({
      enabled: true,
      offsetSec: 300,
      intervalMin: 20,
      repeat: 3,
    });
    expect(bellsFrom(draftFrom(stored))).toEqual(stored);
  });

  it('keeps the endless repeat as null through both directions', () => {
    const stored = { enabled: true, offsetSec: 0, intervalSec: 600, repeat: null };

    expect(draftFrom(stored).repeat).toBeNull();
    expect(bellsFrom(draftFrom(stored)).repeat).toBeNull();
  });
});

describe('describeSchedule', () => {
  /** The draft the sheet opens on: bells off, nothing chosen yet. */
  const OFF: BellsDraft = { enabled: false, offsetSec: 0, intervalMin: 10, repeat: null };

  /** Ten-minute bowls from the start, ringing until the sitting ends. */
  const UNLIMITED: BellsDraft = { enabled: true, offsetSec: 0, intervalMin: 10, repeat: null };

  it('says the ending gong is all there is while the switch is off', () => {
    expect(describeSchedule(OFF, 30)).toBe('No interval bells. Only the ending gong.');
  });

  it('names the interval, the offset in words, the repeat and the bowls it will sound', () => {
    expect(describeSchedule(UNLIMITED, 30)).toBe(
      'Bowl every 10 min, starting after 0 min, unlimited. 3 bowls this session.',
    );
  });

  it('counts a single bowl in the singular', () => {
    const once: BellsDraft = { enabled: true, offsetSec: 0, intervalMin: 10, repeat: 3 };

    expect(describeSchedule(once, 5)).toBe(
      'Bowl every 10 min, starting after 0 min, 3×. 1 bowl this session.',
    );
  });

  it('caps the count at the repeat it was given', () => {
    const twice: BellsDraft = { enabled: true, offsetSec: 300, intervalMin: 10, repeat: 2 };

    expect(describeSchedule(twice, 30)).toBe(
      'Bowl every 10 min, starting after 5 min, 2×. 2 bowls this session.',
    );
  });

  it('says no bowl will sound when the offset lands at or past the sitting end', () => {
    const late: BellsDraft = { enabled: true, offsetSec: 1200, intervalMin: 10, repeat: null };

    expect(describeSchedule(late, 15)).toBe(
      'Bowl every 10 min, starting after 20 min, unlimited — no bowl will sound in a 15 min session.',
    );
  });
});
