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

  it('keeps the start button mounted, hidden, once a phase starts', () => {
    render(<PomodoroPage durations={DEFAULT_DURATIONS} />);

    const start = screen.getByRole('button', { name: 'Start focus' });
    const stack = start.parentElement;
    const rows = stack?.children.length ?? 0;
    expect(start.classList.contains('ui-invisible')).toBe(false);

    fireEvent.click(start);

    // Same node, still in the same slot of the same stack: nothing unmounted, so
    // nothing below it can move. `visibility: hidden` also takes it out of the
    // role query, which is why the assertion is node identity plus class.
    expect(stack?.children[4]).toBe(start);
    expect(start.isConnected).toBe(true);
    expect(start.classList.contains('ui-invisible')).toBe(true);
    expect(stack?.children.length).toBe(rows);
  });

  it('keeps the next-phase line mounted, hidden, once a phase starts', () => {
    render(<PomodoroPage durations={DEFAULT_DURATIONS} />);

    const line = screen.getByText(/^Next: /u);
    fireEvent.click(screen.getByRole('button', { name: 'Start focus' }));

    expect(screen.getByText(/^Next: /u)).toBe(line);
    expect(line.classList.contains('ui-invisible')).toBe(true);
  });
});
