jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/today', () => ({ getToday: jest.fn().mockResolvedValue('2026-11-13') }));
// The one seam stubbed is the HTTP transport, so everything between it and the
// action — meal-api, outbox-relay, todo-api — runs as it ships.
jest.mock('@/lib/client', () => ({ callService: jest.fn() }));

import { callService } from '@/lib/client';
import { saveProfileAction } from '@/app/(meals)/meals/target/actions';

/**
 * The target save's **whole** delivery chain, over the real modules.
 *
 * The bug this pins shipped because every suite around it stubbed a seam the chain
 * crosses: the producer suite hand-built `TargetService` with a positional producer,
 * and the target page suite mocked `putMealProfile`, so no test ever asked "after a
 * save, does a rename actually reach todo-service?". On a live stack the answer was
 * no — meal-service enqueued three `todos.rename` rows and `saveProfileAction` never
 * drained them, because every other meal write calls `kickPendingTodos()` and this
 * one did not. The rows were only delivered the next time the owner happened to log a
 * meal, which for a user who only edits their target is never.
 *
 * So this suite stubs exactly one thing: `callService`, the transport. `meal-api`,
 * `lib/outbox-relay` and `todo-api` are the shipped modules, and the assertion is on
 * what reached todo-service.
 */

const MEAL_API_URL = process.env.MEAL_API_URL ?? 'http://127.0.0.1:3106';
const TODO_API_URL = process.env.TODO_API_URL ?? 'http://127.0.0.1:3005';

const mockCallService = callService as unknown as jest.Mock;

/** Three pending rename intents, as meal-service serves them after a target save. */
const PENDING = ['breakfast', 'lunch', 'dinner'].map((group, index) => ({
  id: `r${index}`,
  destination: 'todos.rename',
  payload: JSON.stringify({
    title: `Eat ${group.charAt(0).toUpperCase()}${group.slice(1)} to reach 3508 kcal`,
    originId: `meal:${group}`,
  }),
}));

const target = {
  id: 't1',
  validFrom: '2026-11-13',
  age: 30,
  sex: 'male',
  heightCm: 175,
  weightKg: 70,
  activity: 'moderate',
  goal: 'maintain',
  bmr: 1600,
  tdee: 2400,
  calories: 3508,
  proteinG: 180,
  fatG: 90,
  carbG: 400,
  createdAt: '2026-11-13T00:00:00.000Z',
  updatedAt: '2026-11-13T00:00:00.000Z',
};

/** Route the transport by base URL and path, so a wrong call is a wrong assertion. */
function route(): void {
  mockCallService.mockImplementation((base: string, path: string) => {
    if (base === MEAL_API_URL && path === '/api/target/profile') {
      return Promise.resolve(target);
    }
    if (base === MEAL_API_URL && path === '/api/meal-todo/pending') {
      return Promise.resolve({ intents: PENDING });
    }
    if (base === MEAL_API_URL && path === '/api/meal-todo/published') {
      return Promise.resolve({ updated: PENDING.length });
    }
    return Promise.resolve({});
  });
}

/** Every todo-service path the save reached, in order. */
function todoPaths(): string[] {
  return mockCallService.mock.calls
    .filter(([base]: [string]) => base === TODO_API_URL)
    .map(([, path]: [string, string]) => path);
}

/**
 * Wait for the fire-and-forget drain to settle.
 *
 * `kickPendingTodos()` is deliberately unawaited (the save already succeeded, and the
 * page must not block on delivery), so the sends happen after `saveProfileAction`
 * resolves. Every `callService` in the chain resolves immediately, so a handful of
 * microtask turns is enough; the bound keeps a stuck drain from hanging the suite.
 */
async function settleDrain(): Promise<void> {
  for (let turn = 0; turn < 50; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    const reported = mockCallService.mock.calls.some(
      ([base, path]: [string, string]) =>
        base === MEAL_API_URL && path === '/api/meal-todo/published',
    );
    if (reported) return;
  }
  throw new Error('the drain never reported an outcome');
}

beforeEach(() => {
  mockCallService.mockReset();
  route();
});

it('drains the renames a target save enqueued, all the way to todo-service', async () => {
  await saveProfileAction({
    age: 30,
    sex: 'male',
    heightCm: 175,
    weightKg: 70,
    activity: 'moderate',
    goal: 'maintain',
  });

  await settleDrain();

  // The save is still the first call: nothing may be delivered for a row the
  // service has not written yet.
  expect(mockCallService.mock.calls[0][1]).toBe('/api/target/profile');
  expect(todoPaths()).toEqual([
    '/api/todos/origin/meal%3Abreakfast/rename',
    '/api/todos/origin/meal%3Alunch/rename',
    '/api/todos/origin/meal%3Adinner/rename',
  ]);
});

it('reports each rename as published, so the rows stop occupying the queue', async () => {
  await saveProfileAction({
    age: 30,
    sex: 'male',
    heightCm: 175,
    weightKg: 70,
    activity: 'moderate',
    goal: 'maintain',
  });

  await settleDrain();

  const report = mockCallService.mock.calls.find(
    ([base, path]: [string, string]) =>
      base === MEAL_API_URL && path === '/api/meal-todo/published',
  ) as [string, string, RequestInit] | undefined;
  expect(report).toBeDefined();
  expect(JSON.parse(String(report?.[2].body)).records).toEqual([
    { id: 'r0', published: true },
    { id: 'r1', published: true },
    { id: 'r2', published: true },
  ]);
});

it('still fails the save loudly when the profile write itself fails, and delivers nothing', async () => {
  mockCallService.mockImplementation((base: string, path: string) => {
    if (base === MEAL_API_URL && path === '/api/target/profile') {
      return Promise.reject(new Error('API 500 on /api/target/profile'));
    }
    return Promise.resolve({ intents: [] });
  });

  await expect(
    saveProfileAction({
      age: 30,
      sex: 'male',
      heightCm: 175,
      weightKg: 70,
      activity: 'moderate',
      goal: 'maintain',
    }),
  ).rejects.toThrow('API 500 on /api/target/profile');

  expect(todoPaths()).toEqual([]);
});
