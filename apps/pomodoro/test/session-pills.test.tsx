import { render, screen } from '@testing-library/react';

import { SESSIONS_PER_CYCLE, type Phase, type Status } from '../src/timer';
import { SessionPills } from '../src/session-pills';

/** The dots the row filled, read the way the browser paints them. */
function filledDots(): number {
  return document.querySelectorAll('.ui-pill--active').length;
}

function renderPills(phase: Phase, session: number, status: Status = 'running'): void {
  render(<SessionPills phase={phase} status={status} session={session} />);
}

/**
 * The pill row for every state the machine reaches, from the cycle table in
 * `timer.test.ts`: the phase just entered, and the session it belongs to.
 */
const pillTable: { phase: Phase; status: Status; session: number; filled: number }[] = [
  // A focus in flight is a session in progress, not a session behind: no dot yet.
  { phase: 'focus', status: 'running', session: 1, filled: 0 },
  { phase: 'focus', status: 'paused', session: 1, filled: 0 },
  // Its own boundary is where the session lands behind the timer, so the dot fills
  // then — not when the break after it is started.
  { phase: 'focus', status: 'boundary', session: 1, filled: 1 },
  // A break belongs to the session it follows, so it keeps that session's dot.
  { phase: 'short', status: 'idle', session: 1, filled: 1 },
  { phase: 'short', status: 'running', session: 1, filled: 1 },
  { phase: 'focus', status: 'boundary', session: 2, filled: 2 },
  { phase: 'short', status: 'boundary', session: 2, filled: 2 },
  { phase: 'focus', status: 'running', session: 3, filled: 2 },
  { phase: 'focus', status: 'boundary', session: 4, filled: 4 },
  // The long break ends the cycle: all four dots filled.
  { phase: 'long', status: 'running', session: 4, filled: 4 },
  // And the focus after it starts the cycle over with none.
  { phase: 'focus', status: 'running', session: 1, filled: 0 },
];

describe('SessionPills', () => {
  it.each(pillTable)(
    'fills $filled dots for $status $phase of session $session',
    ({ phase, status, session, filled }) => {
      renderPills(phase, session, status);

      expect(document.querySelectorAll('.ui-pill')).toHaveLength(SESSIONS_PER_CYCLE);
      expect(filledDots()).toBe(filled);
    },
  );

  it('draws each dot as the reference circle, not as a chip', () => {
    renderPills('short', 2, 'running');

    // §8's `.dot` is a square 8px box on the pill radius; the chip's own height,
    // inset and neutral fill are what the row overrides, and every one is token-scaled.
    const dots = Array.from(document.querySelectorAll('.ui-pill'));
    expect(dots).toHaveLength(SESSIONS_PER_CYCLE);
    for (const dot of dots) {
      expect(dot.className).toContain('size-[var(--s2)]!');
      expect(dot.className).toContain('p-0!');
      expect(dot.className).toContain('border-[length:var(--border-width-strong)]!');
    }
    // An empty session's dot is the ring alone, never the pill's grey fill.
    const empty = dots.filter((dot) => !dot.classList.contains('ui-pill--active'));
    expect(empty.length).toBeGreaterThan(0);
    for (const dot of empty) expect(dot.className).toContain('bg-transparent!');
  });

  it('names the session once, on the row, for assistive tech', () => {
    renderPills('short', 2, 'running');

    // The dots are a picture, not a read-out: the count lives in the label.
    const row = screen.getByRole('img');
    expect(row.getAttribute('aria-label')).toBe(`Session 2 of ${SESSIONS_PER_CYCLE}`);
    expect(row.textContent).toBe('');
  });
});
