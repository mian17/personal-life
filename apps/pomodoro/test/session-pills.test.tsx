import { render, screen } from '@testing-library/react';

import { SESSIONS_PER_CYCLE, type Phase } from '../src/timer';
import { SessionPills } from '../src/session-pills';

/** The dots the row filled, read the way the browser paints them. */
function filledDots(): number {
  return document.querySelectorAll('.ui-pill--active').length;
}

function renderPills(phase: Phase, session: number): void {
  render(<SessionPills phase={phase} session={session} />);
}

/**
 * The pill row for every state the machine reaches, from the cycle table in
 * `timer.test.ts`: the phase just entered, and the session it belongs to.
 */
const pillTable: { phase: Phase; session: number; filled: number }[] = [
  // A first focus is a session in progress, not a session behind: no dot yet.
  { phase: 'focus', session: 1, filled: 0 },
  // A break belongs to the session it follows, so it keeps that session's dot.
  { phase: 'short', session: 1, filled: 1 },
  { phase: 'focus', session: 2, filled: 1 },
  { phase: 'short', session: 2, filled: 2 },
  { phase: 'focus', session: 3, filled: 2 },
  { phase: 'short', session: 3, filled: 3 },
  { phase: 'focus', session: 4, filled: 3 },
  // The long break ends the cycle: all four dots filled.
  { phase: 'long', session: 4, filled: 4 },
  // And the focus after it starts the cycle over with none.
  { phase: 'focus', session: 1, filled: 0 },
];

describe('SessionPills', () => {
  it.each(pillTable)(
    'fills $filled dots for $phase of session $session',
    ({ phase, session, filled }) => {
      renderPills(phase, session);

      expect(document.querySelectorAll('.ui-pill')).toHaveLength(SESSIONS_PER_CYCLE);
      expect(filledDots()).toBe(filled);
    },
  );

  it('names the session once, on the row, for assistive tech', () => {
    renderPills('short', 2);

    const row = screen.getByRole('group');
    expect(row.getAttribute('aria-label')).toBe(`Session 2 of ${SESSIONS_PER_CYCLE}`);
    // The dots are a picture, not a read-out: the count lives in the label.
    expect(row.textContent).toBe('');
  });
});
