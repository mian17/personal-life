jest.mock('@/lib/client', () => ({ callService: jest.fn() }));

import { callService } from '@/lib/client';
import { ApiError } from '@/lib/api-error';
import { listSessions, recordSession, listGoals, setGoal, type SessionRow } from '@/lib/focus-api';

const mockCallService = callService as unknown as jest.Mock;

function upstreamReturned(value: unknown): void {
  mockCallService.mockResolvedValueOnce(value);
}

function lastCall(): [string, string, RequestInit | undefined] {
  return mockCallService.mock.calls[0] as [string, string, RequestInit | undefined];
}

beforeEach(() => {
  mockCallService.mockReset();
});

describe('listSessions', () => {
  it('encodes both client days as query parameters, not path segments', async () => {
    upstreamReturned([]);

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
      createdAt: '2026-10-02T09:00:00.000Z',
    };
    upstreamReturned([row]);

    await expect(listSessions('2026-10-01', '2026-10-07')).resolves.toEqual([row]);
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
      createdAt: '2026-10-03T09:00:00.000Z',
    };
    upstreamReturned([legacyRow]);

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
    upstreamReturned(goals);

    await expect(listGoals()).resolves.toEqual(goals);

    const [, path, init] = lastCall();
    expect(path).toBe('/api/goal');
    expect(init).toBeUndefined();
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
