jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('next/navigation', () => ({ redirect: jest.fn() }));
jest.mock('@/lib/focus-api', () => ({
  answerFocusQuestion: jest.fn(),
  recordSession: jest.fn(),
  setGoal: jest.fn(),
}));
jest.mock('@/lib/todo-api', () => ({ updateTodo: jest.fn() }));
jest.mock('@/lib/today', () => ({ getToday: jest.fn() }));

import { updateTodo } from '@/lib/todo-api';
import { answerFocusQuestion, recordSession } from '@/lib/focus-api';
import { getToday } from '@/lib/today';
import { answerFocusQuestionAction, recordFocusSession } from '@/app/pomodoro/actions';

/**
 * The two writes the "done?" question makes, at the server-action seam.
 *
 * `Done` ticks the task through the **owner's own** `PATCH /api/todos/:id` — the
 * ordinary user edit, so no write grant and no producer route is involved — and writes
 * the answer down either way, which is what stops the question returning. `Not yet`
 * writes the answer and touches no todo at all.
 */

const updateMock = updateTodo as jest.Mock;
const answerMock = answerFocusQuestion as jest.Mock;
const recordMock = recordSession as jest.Mock;
const todayMock = getToday as jest.Mock;

beforeEach(() => {
  updateMock.mockReset();
  answerMock.mockReset();
  recordMock.mockReset();
  todayMock.mockReset();
  todayMock.mockResolvedValue('2026-10-02');
  updateMock.mockResolvedValue({});
  answerMock.mockResolvedValue({});
  recordMock.mockResolvedValue({ id: 'session-1' });
});

describe('answerFocusQuestionAction', () => {
  it('ticks the task with the owner’s own patch when the answer is Done', async () => {
    await answerFocusQuestionAction('session-1', 't1', 'done');

    expect(updateMock).toHaveBeenCalledWith('t1', { done: true });
    expect(answerMock).toHaveBeenCalledWith('session-1');
  });

  it('writes the answer and nothing else when the answer is Not yet', async () => {
    await answerFocusQuestionAction('session-1', 't1', 'not-yet');

    expect(updateMock).not.toHaveBeenCalled();
    // Both answers are answers: each one records it, so the question is asked once.
    expect(answerMock).toHaveBeenCalledWith('session-1');
  });
});

describe('recordFocusSession', () => {
  it('carries the picked task id to the session it records', async () => {
    await expect(recordFocusSession(25, 't1')).resolves.toEqual({ id: 'session-1' });

    expect(recordMock).toHaveBeenCalledWith('2026-10-02', 25, 't1');
  });

  it('records a block with no task when none was picked', async () => {
    await recordFocusSession(25);

    expect(recordMock).toHaveBeenCalledWith('2026-10-02', 25, undefined);
  });

  it('keeps a part-minute block out of the day, and raises no question for one', async () => {
    await expect(recordFocusSession(0, 't1')).resolves.toBeNull();

    expect(recordMock).not.toHaveBeenCalled();
  });
});
