import { fireEvent, render, screen } from '@testing-library/react';
import { PomodoroPage } from '../src/pomodoro-page';
import { DEFAULT_DURATIONS, MINUTE_MS } from '../src/timer';

/**
 * The card centres its rows with `place-content`, so a row that unmounts makes
 * the card shorter and the whole read-out shifts by half of what was lost. Every
 * row therefore stays mounted and only loses its paint — this is the property,
 * not the class name: the row is still the same node, in the same position, and
 * the card still has the same number of children.
 */
/** The mode the hook writes back on every settle, which is also what a reload restores. */
function storeMode(mode: {
  phase: string;
  session: number;
  status: string;
  remainingMs: number;
  endsAt: number;
}): void {
  window.localStorage.setItem('pomodoro-mode', JSON.stringify({ ...mode, heldMs: mode.remainingMs }));
}

describe('PomodoroPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  /** Reset sits on the left of the one action row, whatever it is painted as. */
  function resetButton(): HTMLElement {
    return screen.getByRole('button', { name: 'Reset' });
  }

  /**
   * A cycle only leaves its first session by running one out, and the machine has
   * no seam to jump, so the state comes back from the stored mode a reload would
   * read: paused, second session, 10 minutes still frozen.
   */
  function renderPausedLaterSession(): void {
    storeMode({
      phase: 'short',
      session: 2,
      status: 'paused',
      remainingMs: 10 * MINUTE_MS,
      endsAt: Date.now() + 10 * MINUTE_MS,
    });

    render(<PomodoroPage durations={DEFAULT_DURATIONS} />);
  }

  /** The card's rows are the layout: a row that unmounts shrinks the centring. */
  function actionRow(button: HTMLElement): HTMLElement {
    const row = button.parentElement;
    if (!row) throw new Error('action button has no parent row');
    return row;
  }

  it('keeps one button in the same action slot through start, pause and resume', () => {
    render(<PomodoroPage durations={DEFAULT_DURATIONS} />);

    const start = screen.getByRole('button', { name: 'Start focus' });
    const row = actionRow(start);
    const stack = row.parentElement;
    const rows = stack?.children.length ?? 0;
    expect(row.classList.contains('ui-invisible')).toBe(false);
    expect(row.children.length).toBe(2);

    fireEvent.click(start);

    // Same node, same slot: the label changes, the box does not move or vanish.
    expect(stack?.children[4]).toBe(row);
    expect(start.isConnected).toBe(true);
    expect(start.textContent).toBe('Pause');
    expect(stack?.children.length).toBe(rows);
    expect(row.children.length).toBe(2);

    fireEvent.click(start);

    expect(start.textContent).toBe('Resume');
    expect(stack?.children[4]).toBe(row);
  });

  it('cannot reset before the cycle has begun', () => {
    render(<PomodoroPage durations={DEFAULT_DURATIONS} />);

    expect(resetButton()).toHaveProperty('disabled', true);
  });

  it('cannot reset while the phase is counting down', () => {
    render(<PomodoroPage durations={DEFAULT_DURATIONS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start focus' }));

    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(resetButton()).toHaveProperty('disabled', true);
  });

  it('can reset a paused phase, because the frozen time is what it gives up', () => {
    render(<PomodoroPage durations={DEFAULT_DURATIONS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start focus' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));

    expect(resetButton()).toHaveProperty('disabled', false);
  });

  it('leaves the cycle alone when the reset confirmation is declined', () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      renderPausedLaterSession();

      fireEvent.click(resetButton());

      expect(confirm).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
    } finally {
      confirm.mockRestore();
    }
  });

  it('starts the cycle over from the first focus when the reset is confirmed', () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      renderPausedLaterSession();

      fireEvent.click(resetButton());

      expect(confirm).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Start focus' })).toBeTruthy();
      expect(resetButton()).toHaveProperty('disabled', true);
    } finally {
      confirm.mockRestore();
    }
  });

  it('cannot reset the first session\'s focus once it sits at its boundary', () => {
    storeMode({ phase: 'focus', session: 1, status: 'boundary', remainingMs: 0, endsAt: 1_000 });

    render(<PomodoroPage durations={DEFAULT_DURATIONS} />);

    expect(screen.getByText(/^Next: /u)).toBeTruthy();
    expect(resetButton()).toHaveProperty('disabled', true);
  });

  it('can reset a break boundary, because a finished focus is progress', () => {
    storeMode({ phase: 'short', session: 1, status: 'boundary', remainingMs: 0, endsAt: 1_000 });

    render(<PomodoroPage durations={DEFAULT_DURATIONS} />);

    expect(resetButton()).toHaveProperty('disabled', false);
  });

  it('can reset a break in progress once it is paused', () => {
    storeMode({ phase: 'long', session: 4, status: 'paused', remainingMs: 5 * MINUTE_MS, endsAt: 1_000 });

    render(<PomodoroPage durations={DEFAULT_DURATIONS} />);

    expect(resetButton()).toHaveProperty('disabled', false);
  });

  it('cannot reset a break while it counts down', () => {
    storeMode({
      phase: 'short',
      session: 1,
      status: 'running',
      remainingMs: 4 * MINUTE_MS,
      endsAt: Date.now() + 4 * MINUTE_MS,
    });

    render(<PomodoroPage durations={DEFAULT_DURATIONS} />);

    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(resetButton()).toHaveProperty('disabled', true);
  });

  it('keeps the next-phase line mounted, hidden, once a phase starts', () => {
    render(<PomodoroPage durations={DEFAULT_DURATIONS} />);

    const line = screen.getByText(/^Next: /u);
    fireEvent.click(screen.getByRole('button', { name: 'Start focus' }));

    expect(screen.getByText(/^Next: /u)).toBe(line);
    expect(line.classList.contains('ui-invisible')).toBe(true);
  });
});
