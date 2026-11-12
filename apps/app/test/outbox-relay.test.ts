jest.mock('@/lib/client', () => ({ callService: jest.fn() }));

import { callService } from '@/lib/client';
import { ApiError } from '@/lib/api-error';
import { deliverPendingTodos } from '@/lib/outbox-relay';

/**
 * The relay's contract: it reads meal-service's queue, sends each intent to
 * todo-service **with the caller's own token** (the only credential a grant names),
 * and reports the whole batch once.
 *
 * `callService` is mocked, so the assertions are on what the relay asked the BFF
 * transport to do — which is where the token lives (`lib/client.ts` attaches it, the
 * relay never touches it). That is why "the session token is attached" is asserted as
 * "the call went through `callService`": the relay has no other way to reach a service,
 * and a direct `fetch` here would bypass the session entirely.
 */

const mockCallService = callService as unknown as jest.Mock;

const MEAL_API_URL = 'http://127.0.0.1:3106';
const TODO_API_URL = 'http://127.0.0.1:3005';

/** One pending intent as meal-service serves it. */
function intent(id: string, destination: string, payload: Record<string, unknown>) {
  return { id, destination, payload: JSON.stringify(payload) };
}

const createPayload = {
  title: 'Eat Breakfast to reach 2200 kcal',
  originId: 'meal:breakfast',
  repeat: 'daily',
  dueDate: '2026-09-03',
};

const tickPayload = {
  title: 'Eat Breakfast to reach 2200 kcal',
  occurrence: '2026-09-03',
  originId: 'meal:breakfast',
};

/**
 * Route the mocked transport by base URL and path, so the test states which call
 * failed rather than relying on call order for the outcomes.
 */
function routePending(intents: Array<ReturnType<typeof intent>>): void {
  mockCallService.mockImplementation((base: string, path: string) => {
    if (base === MEAL_API_URL && path === '/api/meal-todo/pending') {
      return Promise.resolve({ intents });
    }
    if (base === MEAL_API_URL && path === '/api/meal-todo/published') {
      return Promise.resolve({ updated: intents.length });
    }
    return Promise.resolve({});
  });
}

/** The published report this drain sent, if any. */
function reportedRecords(): Array<{ id: string; published: boolean; lastError?: string }> {
  const call = mockCallService.mock.calls.find(
    ([base, path]: [string, string]) =>
      base === MEAL_API_URL && path === '/api/meal-todo/published',
  ) as [string, string, RequestInit] | undefined;
  return call ? JSON.parse(String(call[2].body)).records : [];
}

/** The todo-service paths this drain called, in order. */
function todoCalls(): string[] {
  return mockCallService.mock.calls
    .filter(([base]: [string]) => base === TODO_API_URL)
    .map(([, path]: [string, string]) => path);
}

beforeEach(() => {
  mockCallService.mockReset();
});

test('a create intent becomes POST /api/todos/origin with its payload intact', async () => {
  routePending([intent('i1', 'todos.create', createPayload)]);

  const result = await deliverPendingTodos();

  expect(result).toEqual({ delivered: 1, failed: 0 });
  expect(todoCalls()).toEqual(['/api/todos/origin']);
  const [, , init] = mockCallService.mock.calls.find(
    ([base, path]: [string, string]) => base === TODO_API_URL && path === '/api/todos/origin',
  ) as [string, string, RequestInit];
  expect(init.method).toBe('POST');
  expect(JSON.parse(String(init.body))).toEqual({
    title: 'Eat Breakfast to reach 2200 kcal',
    originId: 'meal:breakfast',
    repeat: 'daily',
    dueDate: '2026-09-03',
  });
  expect(reportedRecords()).toEqual([{ id: 'i1', published: true }]);
});

test('a tick intent completes the origin task it names, pinned to its occurrence', async () => {
  routePending([intent('i2', 'todos.complete', tickPayload)]);

  await deliverPendingTodos();

  expect(todoCalls()).toEqual(['/api/todos/origin/meal%3Abreakfast/complete']);
  const [, , init] = mockCallService.mock.calls.find(
    ([base]: [string]) => base === TODO_API_URL,
  ) as [string, string, RequestInit];
  expect(JSON.parse(String(init.body))).toEqual({
    title: 'Eat Breakfast to reach 2200 kcal',
    occurrence: '2026-09-03',
  });
});

test('a 409 counts as delivered, because a create is idempotent by origin id', async () => {
  mockCallService.mockImplementation((base: string, path: string) => {
    if (base === MEAL_API_URL)
      return Promise.resolve({
        intents: [intent('i3', 'todos.create', createPayload)],
        updated: 1,
      });
    return Promise.reject(new ApiError(409, 'API 409 on /api/todos/origin'));
  });

  const result = await deliverPendingTodos();

  expect(result).toEqual({ delivered: 1, failed: 0 });
  expect(reportedRecords()).toEqual([{ id: 'i3', published: true }]);
});

test('a 403 closes the row with a reason instead of retrying it forever', async () => {
  mockCallService.mockImplementation((base: string) => {
    if (base === MEAL_API_URL) {
      return Promise.resolve({
        intents: [intent('i4', 'todos.create', createPayload)],
        updated: 1,
      });
    }
    return Promise.reject(new ApiError(403, 'API 403 on /api/todos/origin'));
  });

  const result = await deliverPendingTodos();

  expect(result).toEqual({ delivered: 1, failed: 0 });
  const [record] = reportedRecords();
  expect(record.id).toBe('i4');
  expect(record.published).toBe(true);
  expect(record.lastError).toContain('403');
});

test('a transient 500 leaves the row pending with its reason', async () => {
  mockCallService.mockImplementation((base: string) => {
    if (base === MEAL_API_URL) {
      return Promise.resolve({
        intents: [intent('i5', 'todos.create', createPayload)],
        updated: 1,
      });
    }
    return Promise.reject(new ApiError(500, 'API 500 on /api/todos/origin'));
  });

  const result = await deliverPendingTodos();

  expect(result).toEqual({ delivered: 0, failed: 1 });
  expect(reportedRecords()).toEqual([
    { id: 'i5', published: false, lastError: 'API 500 on /api/todos/origin' },
  ]);
});

test('one failing row does not stop the rows behind it', async () => {
  mockCallService.mockImplementation((base: string, path: string, init?: RequestInit) => {
    if (base === MEAL_API_URL) {
      return Promise.resolve({
        intents: [
          intent('bad', 'todos.create', { title: 'no origin id' }),
          intent('good', 'todos.create', createPayload),
        ],
        updated: 2,
      });
    }
    if (JSON.parse(String(init?.body)).originId === 'meal:breakfast') {
      return Promise.resolve({});
    }
    return Promise.reject(new ApiError(500, 'API 500 on /api/todos/origin'));
  });

  const result = await deliverPendingTodos();

  expect(result).toEqual({ delivered: 1, failed: 1 });
  expect(reportedRecords()).toEqual([
    { id: 'bad', published: false, lastError: 'create intent is missing title or originId' },
    { id: 'good', published: true },
  ]);
});

test('a tick with no originId is skipped with a reason, never guessed at', async () => {
  routePending([intent('i6', 'todos.complete', { title: 't', occurrence: '2026-09-03' })]);

  const result = await deliverPendingTodos();

  // Nothing was sent: a tick with no task to name would tick the wrong one.
  expect(todoCalls()).toEqual([]);
  expect(result).toEqual({ delivered: 0, failed: 1 });
  expect(reportedRecords()[0].lastError).toContain('originId');
});

test('the whole batch is reported in one call, not one per row', async () => {
  routePending([
    intent('i7', 'todos.create', createPayload),
    intent('i8', 'todos.complete', tickPayload),
  ]);

  await deliverPendingTodos();

  const reportCalls = mockCallService.mock.calls.filter(
    ([base, path]: [string, string]) =>
      base === MEAL_API_URL && path === '/api/meal-todo/published',
  );
  expect(reportCalls).toHaveLength(1);
  expect(reportedRecords()).toHaveLength(2);
});

test('every call goes through callService, which is what attaches the session token', async () => {
  routePending([intent('i9', 'todos.create', createPayload)]);

  await deliverPendingTodos();

  // A direct `fetch` in the relay would have no session at all; the transport seam
  // is the assertion that the user's own token is what each call carries.
  expect(mockCallService.mock.calls.length).toBeGreaterThan(0);
  expect(mockCallService.mock.calls.map(([base]: [string]) => base)).toEqual([
    MEAL_API_URL,
    TODO_API_URL,
    MEAL_API_URL,
  ]);
});

test('an empty queue reports nothing at all', async () => {
  routePending([]);

  const result = await deliverPendingTodos();

  expect(result).toEqual({ delivered: 0, failed: 0 });
  expect(todoCalls()).toEqual([]);
  expect(mockCallService).toHaveBeenCalledTimes(1);
});

test('an unreadable queue is a quiet empty result, never a throw into the page', async () => {
  mockCallService.mockRejectedValue(new ApiError(503, 'API 503 on /api/meal-todo/pending'));

  await expect(deliverPendingTodos()).resolves.toEqual({ delivered: 0, failed: 0 });
});
