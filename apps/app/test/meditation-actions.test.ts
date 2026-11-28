jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/meditation-api', () => ({ recordSitting: jest.fn() }));
jest.mock('@/lib/today', () => ({ getToday: jest.fn() }));

import { recordSitting } from '@/lib/meditation-api';
import { getToday } from '@/lib/today';
import { recordFinishedSitting } from '@/app/meditation/actions';

/**
 * The recorded-sitting debug line, at the server-action seam. It is the only place the minutes
 * that landed are visible before the log screen exists, so it has to print outside production —
 * and a production run has to keep the sitter's activity out of the log.
 */

const env = process.env as Record<string, string | undefined>;

const recordMock = recordSitting as jest.Mock;
const todayMock = getToday as jest.Mock;

/** A sitting of nine minutes that ran most of its planned ten. */
const REPORT = { startedAt: '2026-11-28T09:00:00.000Z', plannedMinutes: 10, elapsedSeconds: 540 };

const originalNodeEnv = env.NODE_ENV;

beforeEach(() => {
  jest.clearAllMocks();
  env.NODE_ENV = originalNodeEnv;
  todayMock.mockResolvedValue('2026-11-28');
  recordMock.mockResolvedValue({});
  jest.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  env.NODE_ENV = originalNodeEnv;
  jest.restoreAllMocks();
});

describe('announceRecordedSitting', () => {
  it('prints the day, the minutes that landed and the ending outside production', async () => {
    await recordFinishedSitting(REPORT);

    expect(console.debug).toHaveBeenCalledWith(
      'meditation: recorded 9 minutes (finished) for 2026-11-28',
    );
  });

  it('prints nothing in production, and still records the sitting', async () => {
    env.NODE_ENV = 'production';

    await recordFinishedSitting(REPORT);

    expect(console.debug).not.toHaveBeenCalled();
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'finished' }));
  });
});
