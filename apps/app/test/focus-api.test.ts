jest.mock('@/lib/client', () => ({ callService: jest.fn() }));

import { callService } from '@/lib/client';
import { ApiError } from '@/lib/api-error';
import { listSessions, recordSession, listGoals, setGoal, type SessionRow } from '@/lib/focus-api';

const mockCallService = callService as unknown as jest.Mock;

function upstreamReturned(value: unknown): void {
  mockCallService.mockResolvedValueOnce(value);
}

/** One session row keyed by id, for the paging cases. */
function sessionOn(id: string, date: string): SessionRow {
  return {
    id,
    ownerSub: 'owner-1',
    date,
    minutes: 25,
    todoId: null,
    todoAnsweredAt: null,
    createdAt: `${date}T09:00:00.000Z`,
  };
}

function lastCall(): [string, string, RequestInit | undefined] {
  return mockCallService.mock.calls[0] as [string, string, RequestInit | undefined];
}

beforeEach(() => {
  mockCallService.mockReset();
});

describe('listSessions', () => {
  it('encodes both client days as query parameters, not path segments', async () => {
    upstreamReturned({ sessions: [], nextCursor: null });

    await listSessions('2026-10-01', '2026-10-07');

    const [base, path] = lastCall();
    expect(base).toBe('http://127.0.0.1:3107');
    expect(path).toBe('/api/sessions?from=2026-10-01&to=2026-10-07');
  });

  it('returns the rows the service sent', async () => {
    const row = {
      id: 's1',
      ownerSub: 'owner-1',
      date: '2026-10-02',
      minutes: 25,
      todoId: null,
      todoAnsweredAt: null,
      createdAt: '2026-10-02T09:00:00.000Z',
    };
    upstreamReturned({ sessions: [row], nextCursor: null });

    await expect(listSessions('2026-10-01', '2026-10-07')).resolves.toEqual([row]);
  });

  it('walks every page, so a window past the first page is not silently truncated', async () => {
    // The stats screen buckets every row in the window; one page would under-count.
    const one = sessionOn('s1', '2026-10-02');
    const two = sessionOn('s2', '2026-10-03');
    upstreamReturned({ sessions: [one], nextCursor: 'page-2' });
    upstreamReturned({ sessions: [two], nextCursor: null });

    await expect(listSessions('2026-10-01', '2026-10-07')).resolves.toEqual([one, two]);

    const [, secondPath] = mockCallService.mock.calls[1] as [string, string];
    expect(secondPath).toBe('/api/sessions?from=2026-10-01&to=2026-10-07&cursor=page-2');
  });

  it('types the owner as nullable, matching the service DTO', async () => {
    // The column is nullable (`session.entity.ts`), so a legacy row may carry no
    // owner; annotating the row with `SessionRow` makes this a typecheck tripwire
    // against narrowing the wire type here (`SPEC-focus-service` §7).
    const legacyRow: SessionRow = {
      id: 's2',
      ownerSub: null,
      date: '2026-10-03',
      minutes: 50,
      todoId: null,
      todoAnsweredAt: null,
      createdAt: '2026-10-03T09:00:00.000Z',
    };
    upstreamReturned({ sessions: [legacyRow], nextCursor: null });

    await expect(listSessions('2026-10-01', '2026-10-07')).resolves.toEqual([legacyRow]);
  });
});

describe('recordSession', () => {
  it('posts the day and minutes the caller supplied', async () => {
    upstreamReturned({});

    await recordSession('2026-10-02', 25);

    const [, path, init] = lastCall();
    expect(path).toBe('/api/sessions');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ date: '2026-10-02', minutes: 25 });
  });

  it('rethrows the upstream ApiError unchanged', async () => {
    const refusal = new ApiError(400, 'minutes out of range');
    mockCallService.mockRejectedValueOnce(refusal);

    await expect(recordSession('2026-10-02', 0)).rejects.toBe(refusal);
  });
});

describe('listGoals', () => {
  it('reads the whole goal history', async () => {
    const goals = [
      { validFrom: '2026-09-01', minutes: 60 },
      { validFrom: '2026-10-01', minutes: 90 },
    ];
    upstreamReturned({ goals, nextCursor: null });

    await expect(listGoals()).resolves.toEqual(goals);

    const [, path, init] = lastCall();
    expect(path).toBe('/api/goal');
    expect(init).toBeUndefined();
  });

  it('walks every page, so day → goal never resolves against a partial history', async () => {
    // `resolveGoal` answers the newest row at or before a day; a single page would
    // silently pick an older row for any day whose governing row fell past it.
    const older = { validFrom: '2026-09-01', minutes: 60 };
    const newer = { validFrom: '2026-10-01', minutes: 90 };
    upstreamReturned({ goals: [older], nextCursor: 'page-2' });
    upstreamReturned({ goals: [newer], nextCursor: null });

    await expect(listGoals()).resolves.toEqual([older, newer]);

    const [, secondPath] = mockCallService.mock.calls[1] as [string, string];
    expect(secondPath).toBe('/api/goal?cursor=page-2');
  });
});

describe('setGoal', () => {
  it('puts the day the goal takes effect on', async () => {
    upstreamReturned({ validFrom: '2026-10-02', minutes: 90 });

    await setGoal('2026-10-02', 90);

    const [, path, init] = lastCall();
    expect(path).toBe('/api/goal');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ date: '2026-10-02', minutes: 90 });
  });

  it('rethrows the upstream ApiError unchanged', async () => {
    const refusal = new ApiError(400, 'date must be YYYY-MM-DD');
    mockCallService.mockRejectedValueOnce(refusal);

    await expect(setGoal('02/10/2026', 90)).rejects.toBe(refusal);
  });
});
