/**
 * @jest-environment jsdom
 *
 * The task picker and the "done?" prompt, driven through `TimerRecorder` — the client
 * adapter that owns both — where the timer itself is the real `@life/pomodoro` page.
 *
 * What is asserted is the seam the owner sees: a picked task rides the record call, the
 * prompt follows the record (never precedes it), `Done` ticks through the owner's own
 * `PATCH /api/todos/:id`, and `Not yet` ticks nothing. The two record moments are the
 * hook's own (boundary and stop mid-focus), so exercising both here is the whole point.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('../app/pomodoro/actions', () => ({
  setPomodoroFocusMinutes: jest.fn(),
  setPomodoroBreakMinutes: jest.fn(),
  recordFocusSession: jest.fn(),
  answerFocusQuestionAction: jest.fn(),
}));

import { answerFocusQuestionAction, recordFocusSession } from '../app/pomodoro/actions';
import { TimerRecorder } from '../app/pomodoro/timer-recorder';

const recordMock = recordFocusSession as jest.Mock;
const answerMock = answerFocusQuestionAction as jest.Mock;

/** A one-minute focus phase, so a boundary costs a second of fake time and no wait. */
const ONE_MINUTE = { focus: 1, short: 1, long: 1 };
const MINUTE_MS = 60_000;

const TASKS = [{ id: 't1', title: 'Prep lunch' }];

/** The boundary announces itself with a beep; jsdom ships no WebAudio of its own. */
function stubAudioContext(): void {
  class SilentAudioContext {
    currentTime = 0;
    destination = {};
    resume(): Promise<void> {
      return Promise.resolve();
    }
    close(): Promise<void> {
      return Promise.resolve();
    }
    createOscillator() {
      return {
        frequency: { value: 0 },
        connect: () => undefined,
        start: () => undefined,
        stop: () => undefined,
        onended: null,
      };
    }
  }

  (globalThis as unknown as { AudioContext: unknown }).AudioContext = SilentAudioContext;
}

/** The boundary of a one-minute focus phase, with a task named for it. */
async function runOneFocusBlock(taskTitle = 'Prep lunch'): Promise<void> {
  render(<TimerRecorder durations={ONE_MINUTE} tasks={TASKS} />);

  fireEvent.change(screen.getByLabelText('Working on'), {
    target: { value: TASKS.find((task) => task.title === taskTitle)?.id ?? '' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Start focus' }));
  await act(async () => {
    jest.advanceTimersByTime(MINUTE_MS + 1_000);
  });
}

describe('the task picker', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
    stubAudioContext();
    recordMock.mockReset();
    answerMock.mockReset();
    recordMock.mockResolvedValue({ id: 'session-1' });
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  it('draws no picker at all when there are no tasks, so a failed read costs nothing', () => {
    render(<TimerRecorder durations={ONE_MINUTE} />);

    expect(screen.queryByLabelText('Working on')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start focus' })).toBeTruthy();
  });

  it('starts from no task, which stays the ordinary case', () => {
    render(<TimerRecorder durations={ONE_MINUTE} tasks={TASKS} />);

    expect(screen.getByLabelText<HTMLSelectElement>('Working on').value).toBe('');
  });

  it('carries the picked id on the record call, not after it', async () => {
    await runOneFocusBlock();

    await waitFor(() => expect(recordMock).toHaveBeenCalledTimes(1));
    expect(recordMock).toHaveBeenCalledWith(1, 't1');
  });

  it('records a block with no task picked exactly as before', async () => {
    render(<TimerRecorder durations={ONE_MINUTE} tasks={TASKS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start focus' }));
    await act(async () => {
      jest.advanceTimersByTime(MINUTE_MS + 1_000);
    });

    await waitFor(() => expect(recordMock).toHaveBeenCalledWith(1, undefined));
    // No task named, so nothing to ask about.
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the "done?" prompt', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
    stubAudioContext();
    recordMock.mockReset();
    answerMock.mockReset();
    recordMock.mockResolvedValue({ id: 'session-1' });
    answerMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  it('asks at the boundary of a block that named a task, showing the minutes', async () => {
    await runOneFocusBlock();

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Finished that task?');
    expect(dialog.textContent).toContain('1 focused minute');
    expect(dialog.textContent).toContain('Prep lunch');
  });

  it('asks after a stop mid-focus too, because that is the same record moment', async () => {
    render(<TimerRecorder durations={{ focus: 5, short: 1, long: 1 }} tasks={TASKS} />);
    fireEvent.change(screen.getByLabelText('Working on'), { target: { value: 't1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start focus' }));
    await act(async () => {
      jest.advanceTimersByTime(70_000);
    });

    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
      fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

      await waitFor(() => expect(recordMock).toHaveBeenCalledWith(1, 't1'));
      expect(await screen.findByRole('dialog')).toBeTruthy();
    } finally {
      confirm.mockRestore();
    }
  });

  it('ticks the task on Done, through the owner’s own patch, and records the answer', async () => {
    await runOneFocusBlock();

    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));

    await waitFor(() => expect(answerMock).toHaveBeenCalledWith('session-1', 't1', 'done'));
  });

  it('puts both actions straight in the footer, so neither wraps the other', async () => {
    await runOneFocusBlock();

    const notYet = await screen.findByRole('button', { name: 'Not yet' });
    const done = screen.getByRole('button', { name: 'Done' });
    const parent = notYet.parentElement;

    // One parent for both, and it is the dialog's own footer — not a wrapper row whose
    // flex-wrap would let the full-width buttons take a line each.
    expect(done.parentElement).toBe(parent);
    expect(parent?.className).toContain('ui-dialog__footer');
    expect(parent?.className).not.toContain('ui-row');
    expect(parent?.childElementCount).toBe(2);
  });

  it('writes nothing further on Not yet except the answer itself', async () => {
    await runOneFocusBlock();

    fireEvent.click(await screen.findByRole('button', { name: 'Not yet' }));

    await waitFor(() => expect(answerMock).toHaveBeenCalledWith('session-1', 't1', 'not-yet'));
    // One record, one answer: nothing ticks the task and nothing writes a second block.
    expect(recordMock).toHaveBeenCalledTimes(1);
  });

  it('asks nothing for a block that named no task', async () => {
    render(<TimerRecorder durations={ONE_MINUTE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start focus' }));
    await act(async () => {
      jest.advanceTimersByTime(MINUTE_MS + 1_000);
    });

    await waitFor(() => expect(recordMock).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('re-asks a stored, unanswered block on the next load, with no client moment involved', () => {
    render(
      <TimerRecorder
        durations={ONE_MINUTE}
        tasks={TASKS}
        pendingQuestion={{ sessionId: 'session-9', todoId: 't1', minutes: 25, title: 'Prep lunch' }}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('25 focused minutes');
    expect(dialog.textContent).toContain('Prep lunch');
  });

  it('stops re-asking once the stored question was answered', () => {
    // The page only hands a question it found unanswered; an answered block yields
    // none, so the mount has nothing to ask.
    render(<TimerRecorder durations={ONE_MINUTE} tasks={TASKS} pendingQuestion={null} />);

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
