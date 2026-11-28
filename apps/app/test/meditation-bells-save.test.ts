jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/meditation-api', () => ({ fetchSettings: jest.fn(), saveSettings: jest.fn() }));
jest.mock('@/lib/today', () => ({ getToday: jest.fn() }));

import { revalidatePath } from 'next/cache';
import { fetchSettings, saveSettings, type SettingsRow } from '@/lib/meditation-api';
import type { BellChoice } from '@/lib/meditation-clock';
import { saveIntervalBells } from '@/app/meditation/actions';

/**
 * The bells sheet's Save, at the server-action seam: the one route from the sheet to the
 * settings `PUT`, and therefore the place two things are settled.
 *
 * The sheet edits `bells` alone, so a schedule edit may not carry a goal or a planned length of
 * its own — those go back to the service as they came out of it. And a write the service refuses
 * has to reject: the sheet awaits it and closes only on a resolve, so a swallowed error would
 * close the sheet on a save that never landed.
 */

const fetchMock = fetchSettings as jest.MockedFunction<typeof fetchSettings>;
const saveMock = saveSettings as jest.MockedFunction<typeof saveSettings>;
const revalidateMock = revalidatePath as jest.Mock;

/** A stored row whose goal and planned length differ from anything a bells edit could invent. */
const STORED: SettingsRow = {
  goalMinutes: 30,
  plannedMinutes: 45,
  bells: { enabled: false, offsetSec: 0, intervalSec: 600, repeat: null },
};

/** The draft the sheet hands over: off and on, ten minutes and twenty, endless and two rings. */
const SAVED: BellChoice = { enabled: true, offsetSec: 300, intervalSec: 1200, repeat: 2 };

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockResolvedValue(STORED);
  saveMock.mockResolvedValue({ ...STORED, bells: SAVED });
});

describe('saveIntervalBells', () => {
  it('replaces the bells and sends the stored goal and planned length back unchanged', async () => {
    await saveIntervalBells(SAVED);

    expect(saveMock).toHaveBeenCalledWith({
      goalMinutes: STORED.goalMinutes,
      plannedMinutes: STORED.plannedMinutes,
      bells: SAVED,
    });
  });

  it('revalidates the route, which is how the row re-reads the bells it just stored', async () => {
    await saveIntervalBells(SAVED);

    expect(revalidateMock).toHaveBeenCalledWith('/meditation');
  });

  it('rejects a refused write and revalidates nothing, so the sheet keeps its draft', async () => {
    saveMock.mockRejectedValue(new Error('settings refused'));

    await expect(saveIntervalBells(SAVED)).rejects.toThrow('settings refused');
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it('writes nothing at all when the settings cannot be read', async () => {
    fetchMock.mockRejectedValue(new Error('meditation-service unreachable'));

    await expect(saveIntervalBells(SAVED)).rejects.toThrow('meditation-service unreachable');
    expect(saveMock).not.toHaveBeenCalled();
  });
});
