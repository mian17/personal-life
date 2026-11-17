/**
 * The interval bells: the fire times a schedule yields, and the scheduler that rings
 * exactly those times and nothing of its own.
 *
 * Every boundary in `SPEC-meditation-app` §6 is asserted at its edge value, and the
 * scheduler is proven against the function's own output rather than a re-derivation.
 */
import { intervalBellTimes, ringIntervalBells, type BellSchedule } from '@/lib/meditation-bells';

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
