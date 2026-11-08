import { fireEvent, render, screen, within } from '@testing-library/react';
import { PomodoroPage } from '../src/pomodoro-page';
import { DEFAULT_DURATIONS, MINUTE_MS, SESSIONS_PER_CYCLE } from '../src/timer';

/** The three chips the card draws, by their visible label. */
const FOCUS_PRESET_LABELS = ['15 min', '25 min', '50 min'] as const;

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

  /** The card's rows are the layout: a row that unmounts shrinks the card's rhythm. */
  function actionRow(button: HTMLElement): HTMLElement {
    const row = button.parentElement;
    if (!row) throw new Error('action button has no parent row');
    return row;
  }

  it('keeps one button in the same action slot through start, pause and resume', () => {
    render(<PomodoroPage durations={DEFAULT_DURATIONS} />);

    const start = screen.getByRole('button', { name: 'Start focus' });
    const row = actionRow(start);
    const card = row.parentElement;
    const slot = Array.from(card?.children ?? []).indexOf(row);
    const rows = card?.children.length ?? 0;
    expect(row.classList.contains('ui-invisible')).toBe(false);
    expect(row.children).toHaveLength(2);

    fireEvent.click(start);

    // Same node, same slot: the label changes, the box does not move or vanish.
    expect(slot).toBeGreaterThan(-1);
    expect(card?.children[slot]).toBe(row);
    expect(start.isConnected).toBe(true);
    expect(start.textContent).toBe('Pause');
    expect(card?.children.length).toBe(rows);
    expect(row.children).toHaveLength(2);

    fireEvent.click(start);

    expect(start.textContent).toBe('Resume');
    expect(card?.children[slot]).toBe(row);
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

  it('can reset a finished first focus while Start break sits unpressed', () => {
    storeMode({ phase: 'focus', session: 1, status: 'boundary', remainingMs: 0, endsAt: 1_000 });

    render(<PomodoroPage durations={DEFAULT_DURATIONS} />);

    // The boundary this case is about: the read-out still says Focus, the break is
    // only offered, and one session is already behind the timer.
    expect(screen.getByText(/^Next: /u)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start break' })).toBeTruthy();
    expect(resetButton()).toHaveProperty('disabled', false);
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
    // The reservation is one ladder row, so the digits-to-track band is `--s8`, not 44.
    expect(line.classList.contains('h-[var(--s4)]')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Start focus' }));

    expect(screen.getByText(/^Next: /u)).toBe(line);
    expect(line.classList.contains('ui-invisible')).toBe(true);
  });

  it('draws the session progress track from the phase the card is counting', () => {
    render(<PomodoroPage durations={DEFAULT_DURATIONS} />);

    // Nothing spent before the first start: the track is drawn at rest, at zero.
    expect(progress()).toBe('0');
  });

  it('marks the chip of the focus length the settings chose as the pressed one', () => {
    render(<PomodoroPage durations={{ ...DEFAULT_DURATIONS, focus: 50 }} />);

    const pressed = screen
      .getAllByText(/^\d+ min$/u)
      .filter((chip) => chip.closest('.ui-pill--active') != null);

    expect(pressed.map((chip) => chip.textContent)).toEqual(['50 min']);
  });

  it('reports and starts a focus length a chip was tapped for', () => {
    const onFocusLengthChange = jest.fn();
    render(
      <PomodoroPage durations={DEFAULT_DURATIONS} onFocusLengthChange={onFocusLengthChange} />,
    );

    expect(digits()).toBe('25:00');

    fireEvent.click(screen.getByRole('button', { name: '50 min' }));

    expect(onFocusLengthChange).toHaveBeenCalledWith(50);
    expect(pressedChips()).toEqual(['50 min']);
    // The timer re-seeded from the choice, not from the prop it mounted with.
    expect(digits()).toBe('50:00');
    expect(progress()).toBe('0');
  });

  it('draws the chips as disabled buttons when there is nowhere to report a choice', () => {
    render(<PomodoroPage durations={DEFAULT_DURATIONS} />);

    const chips = FOCUS_PRESET_LABELS.map((name) => screen.getByRole('button', { name }));

    expect(chips.map((chip) => chip.hasAttribute('disabled'))).toEqual([true, true, true]);
  });

  it('names the cycle position in the Today count', () => {
    render(<PomodoroPage durations={DEFAULT_DURATIONS} />);

    expect(screen.getByText(`0 of ${SESSIONS_PER_CYCLE}`)).toBeTruthy();
  });

  it('reads the day the page handed the card as two pill rows', () => {
    render(
      <PomodoroPage durations={DEFAULT_DURATIONS} todayMinutes={50} todayGoalMinutes={100} />,
    );

    expect(rowTrail('Focus minutes')).toBe('50 min');
    expect(rowTrail('Daily goal')).toBe('50 of 100 min');
  });

  it('draws no day rows when the page handed the card nothing to read', () => {
    render(<PomodoroPage durations={DEFAULT_DURATIONS} />);

    expect(screen.queryByText('Focus minutes')).toBeNull();
    expect(screen.queryByText('Daily goal')).toBeNull();
  });

  /** The digits' own read-out, as the owner reads them. */
  function digits(): string {
    return screen.getByRole('timer').textContent ?? '';
  }

  /** The labels of the chips carrying the pressed treatment, in the order they are drawn. */
  function pressedChips(): string[] {
    return screen
      .getAllByText(/^\d+ min$/u)
      .filter((chip) => chip.closest('.ui-pill--active') != null)
      .map((chip) => chip.textContent ?? '');
  }

  /** The track's own read-out: `<progress>` exposes its value as the element's `value`. */
  function progress(): string {
    return screen.getByRole('progressbar').getAttribute('aria-valuenow') ?? '';
  }

  /** The trailing pill of a read-out row, read by its label. */
  function rowTrail(title: string): string | null {
    const label = screen.getByText(title);
    const row = label.closest('li');
    if (!row) throw new Error(`no row for ${title}`);
    return within(row).getByText(/min$/u).textContent;
  }
});
