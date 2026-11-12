import type { ReactElement } from 'react';

/**
 * `/pomodoro`'s server mount, as the pieces it hands the card: the owner's open tasks
 * (the picker) and the question a stored block still owes (the closed-tab re-ask).
 *
 * The route is a thin shell over four seams — the durations cookie, the day's sessions,
 * the goal history, and the open-task read — so this suite mocks those and asserts the
 * props, the `routes-pomodoro-stats.test.tsx` pattern.
 */
jest.mock('@life/app-kit', () => ({ readPrefNumber: jest.fn() }));
jest.mock('@/lib/focus-api', () => ({ listSessions: jest.fn(), listGoals: jest.fn() }));
jest.mock('@/lib/todo-api', () => ({ listOpenTasks: jest.fn() }));
jest.mock('@/lib/today', () => ({ getToday: jest.fn() }));

import { readPrefNumber } from '@life/app-kit';
import { listGoals, listSessions, type SessionRow } from '@/lib/focus-api';
import { listOpenTasks, type OpenTask } from '@/lib/todo-api';
import { getToday } from '@/lib/today';
import PomodoroRoute from '@/app/pomodoro/page';
import { TimerRecorder } from '@/app/pomodoro/timer-recorder';

const mockedReadPref = readPrefNumber as jest.MockedFunction<typeof readPrefNumber>;
const mockedListSessions = listSessions as jest.MockedFunction<typeof listSessions>;
const mockedListGoals = listGoals as jest.MockedFunction<typeof listGoals>;
const mockedListOpenTasks = listOpenTasks as jest.MockedFunction<typeof listOpenTasks>;
const mockedGetToday = getToday as jest.MockedFunction<typeof getToday>;

const TODAY = '2026-10-28';

function task(id: string, title: string): OpenTask {
  return { id, title, dueDate: null, done: false, version: 0, originService: null };
}

function session(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 'session-1',
    ownerSub: 'owner-1',
    date: TODAY,
    minutes: 25,
    todoId: null,
    todoAnsweredAt: null,
    createdAt: `${TODAY}T09:00:00.000Z`,
    ...overrides,
  };
}

/** The `TimerRecorder` props the route handed its body, which is what the card is built from. */
async function recorderProps(): Promise<Record<string, unknown>> {
  const shell = (await PomodoroRoute()) as ReactElement<{
    body: ReactElement<Record<string, unknown>>;
  }>;
  const recorder = shell.props.body;
  expect(recorder.type).toBe(TimerRecorder);
  return recorder.props;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedReadPref.mockResolvedValue(25);
  mockedGetToday.mockResolvedValue(TODAY);
  mockedListGoals.mockResolvedValue([]);
  mockedListSessions.mockResolvedValue([]);
  mockedListOpenTasks.mockResolvedValue([]);
});

describe('/pomodoro — the task picker', () => {
  it('hands the card the open tasks the grant reaches', async () => {
    mockedListOpenTasks.mockResolvedValue([task('t1', 'Prep lunch')]);

    const props = await recorderProps();

    expect(props.tasks).toEqual([{ id: 't1', title: 'Prep lunch' }]);
  });

  it('degrades to no task list when the read fails, and still mounts the timer', async () => {
    mockedListOpenTasks.mockRejectedValue(new Error('403'));

    const props = await recorderProps();

    // A failed read is not a failed focus session: no picker, and the card is there.
    expect(props.tasks).toEqual([]);
    expect(props.durations).toBeDefined();
  });
});

describe('/pomodoro — the question a closed tab left owing', () => {
  it('asks about a stored block that named a task and was never answered', async () => {
    mockedListOpenTasks.mockResolvedValue([task('t1', 'Prep lunch')]);
    mockedListSessions.mockResolvedValue([session({ todoId: 't1' })]);

    const props = await recorderProps();

    expect(props.pendingQuestion).toEqual({
      sessionId: 'session-1',
      todoId: 't1',
      minutes: 25,
      title: 'Prep lunch',
    });
  });

  it('stops asking once the stored block was answered, either way', async () => {
    mockedListOpenTasks.mockResolvedValue([task('t1', 'Prep lunch')]);
    mockedListSessions.mockResolvedValue([
      session({ todoId: 't1', todoAnsweredAt: `${TODAY}T10:00:00.000Z` }),
    ]);

    expect((await recorderProps()).pendingQuestion).toBeNull();
  });

  it('asks only about the latest such block, so one question is on screen', async () => {
    mockedListOpenTasks.mockResolvedValue([task('t1', 'Prep lunch'), task('t2', 'Write up')]);
    mockedListSessions.mockResolvedValue([
      session({ id: 'old', todoId: 't1', minutes: 25 }),
      session({ id: 'recent', todoId: 't2', minutes: 50 }),
    ]);

    expect((await recorderProps()).pendingQuestion).toMatchObject({
      sessionId: 'recent',
      todoId: 't2',
      minutes: 50,
    });
  });

  it('asks nothing about a task that is no longer open, because ticking it answered', async () => {
    mockedListOpenTasks.mockResolvedValue([]);
    mockedListSessions.mockResolvedValue([session({ todoId: 't1' })]);

    expect((await recorderProps()).pendingQuestion).toBeNull();
  });

  it('asks nothing about a block that named no task', async () => {
    mockedListOpenTasks.mockResolvedValue([task('t1', 'Prep lunch')]);
    mockedListSessions.mockResolvedValue([session()]);

    expect((await recorderProps()).pendingQuestion).toBeNull();
  });
});
