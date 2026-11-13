jest.mock('@/lib/client', () => ({ callService: jest.fn() }));

import { callService } from '@/lib/client';
import { answerFocusQuestion, recordSession } from '@/lib/focus-api';
import { listOpenTasks } from '@/lib/todo-api';

/**
 * The two new wire calls the task link adds, asserted at the seam they cross: the
 * record call's optional id and the answer route.
 *
 * `listOpenTasks` lives here rather than in `todo-api`'s own suite because the three
 * calls are one story — read the open tasks, name one on a block, answer the question
 * the block raises.
 */

const mockCallService = callService as unknown as jest.Mock;

function lastCall(): [string, string, RequestInit | undefined] {
  return mockCallService.mock.calls[0] as [string, string, RequestInit | undefined];
}

beforeEach(() => {
  mockCallService.mockReset();
  mockCallService.mockResolvedValue({});
});

describe('recordSession with a task', () => {
  it('carries the picked id on the record body', async () => {
    await recordSession('2026-10-02', 25, 't1');

    const [, path, init] = lastCall();
    expect(path).toBe('/api/sessions');
    expect(JSON.parse(String(init?.body))).toEqual({
      date: '2026-10-02',
      minutes: 25,
      todoId: 't1',
    });
  });

  it('omits the field entirely when no task was picked', async () => {
    await recordSession('2026-10-02', 25);

    const [, , init] = lastCall();
    // One spelling of "no task": the key is absent, not null.
    expect(JSON.parse(String(init?.body))).toEqual({ date: '2026-10-02', minutes: 25 });
  });
});

describe('answerFocusQuestion', () => {
  it('posts the answer to the session it belongs to', async () => {
    await answerFocusQuestion('session-1');

    const [, path, init] = lastCall();
    expect(path).toBe('/api/sessions/session-1/answer');
    expect(init?.method).toBe('POST');
  });
});

describe('listOpenTasks', () => {
  it('reads the grant-narrowed open tasks from todo-service', async () => {
    mockCallService.mockResolvedValueOnce([
      {
        id: 't1',
        title: 'Prep lunch',
        dueDate: null,
        done: false,
        version: 0,
        originService: null,
      },
    ]);

    await expect(listOpenTasks()).resolves.toEqual([
      {
        id: 't1',
        title: 'Prep lunch',
        dueDate: null,
        done: false,
        version: 0,
        originService: null,
      },
    ]);

    const [base, path] = lastCall();
    expect(base).toBe('http://127.0.0.1:3005');
    expect(path).toBe('/api/todos/origin/open');
  });
});
