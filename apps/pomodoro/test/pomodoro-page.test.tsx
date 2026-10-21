import { fireEvent, render, screen } from '@testing-library/react';
import { PomodoroPage } from '../src/pomodoro-page';
import { DEFAULT_DURATIONS } from '../src/timer';

/**
 * The card centres its rows with `place-content`, so a row that unmounts makes
 * the card shorter and the whole read-out shifts by half of what was lost. Every
 * row therefore stays mounted and only loses its paint — this is the property,
 * not the class name: the row is still the same node, in the same position, and
 * the card still has the same number of children.
 */
describe('PomodoroPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

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

  it('leaves the cycle alone when the reset confirmation is declined', () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      render(<PomodoroPage durations={DEFAULT_DURATIONS} />);
      fireEvent.click(screen.getByRole('button', { name: 'Start focus' }));

      fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

      expect(confirm).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    } finally {
      confirm.mockRestore();
    }
  });

  it('starts the cycle over from the first focus when the reset is confirmed', () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      render(<PomodoroPage durations={DEFAULT_DURATIONS} />);
      fireEvent.click(screen.getByRole('button', { name: 'Start focus' }));

      fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

      expect(confirm).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Start focus' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Reset' })).toHaveProperty('disabled', true);
    } finally {
      confirm.mockRestore();
    }
  });

  it('cannot reset before the cycle has begun', () => {
    render(<PomodoroPage durations={DEFAULT_DURATIONS} />);

    expect(screen.getByRole('button', { name: 'Reset' })).toHaveProperty('disabled', true);
  });

  it('keeps the next-phase line mounted, hidden, once a phase starts', () => {
    render(<PomodoroPage durations={DEFAULT_DURATIONS} />);

    const line = screen.getByText(/^Next: /u);
    fireEvent.click(screen.getByRole('button', { name: 'Start focus' }));

    expect(screen.getByText(/^Next: /u)).toBe(line);
    expect(line.classList.contains('ui-invisible')).toBe(true);
  });
});
