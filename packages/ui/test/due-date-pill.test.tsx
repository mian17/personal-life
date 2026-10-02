import { render, screen } from '@testing-library/react';
import { DueDatePill, dueDateState } from '../src/components/due-date-pill';

function rootOf(): HTMLElement {
  return document.querySelector('.ui-due-pill') as HTMLElement;
}

describe('DueDatePill', () => {
  it('derives the none state and renders the empty label when dueDate is null', () => {
    render(<DueDatePill dueDate={null} today="2026-09-28" />);
    const root = rootOf();
    expect(root.getAttribute('data-state')).toBe('none');
    expect(root.classList.contains('ui-due-pill--none')).toBe(true);
    expect(root.textContent).toBe('No date');
    expect(root.querySelector('time')).toBeNull();
  });

  it('accepts a custom empty label', () => {
    render(<DueDatePill dueDate={null} today="2026-09-28" emptyLabel="Unscheduled" />);
    expect(rootOf().textContent).toBe('Unscheduled');
  });

  it('treats an empty string as no date', () => {
    render(<DueDatePill dueDate="" today="2026-09-28" />);
    expect(rootOf().getAttribute('data-state')).toBe('none');
    expect(rootOf().querySelector('time')).toBeNull();
  });

  it('derives overdue for a past date', () => {
    render(<DueDatePill dueDate="2026-09-27" today="2026-09-28" />);
    expect(rootOf().getAttribute('data-state')).toBe('overdue');
    expect(rootOf().classList.contains('ui-due-pill--overdue')).toBe(true);
  });

  it('derives today for the injected date', () => {
    render(<DueDatePill dueDate="2026-09-28" today="2026-09-28" />);
    expect(rootOf().getAttribute('data-state')).toBe('today');
    expect(rootOf().classList.contains('ui-due-pill--today')).toBe(true);
  });

  it('derives later for a future date', () => {
    render(<DueDatePill dueDate="2026-09-29" today="2026-09-28" />);
    expect(rootOf().getAttribute('data-state')).toBe('later');
    expect(rootOf().classList.contains('ui-due-pill--later')).toBe(true);
  });

  it('renders a <time> element carrying the ISO date', () => {
    render(<DueDatePill dueDate="2026-10-01" today="2026-09-28" />);
    const time = rootOf().querySelector('time')!;
    expect(time.tagName).toBe('TIME');
    expect(time.getAttribute('datetime')).toBe('2026-10-01');
    expect(time.textContent).toBe('2026-10-01');
  });

  it('defaults today to the real local date', () => {
    const now = new Date();
    const iso = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    render(<DueDatePill dueDate={iso} />);
    expect(rootOf().getAttribute('data-state')).toBe('today');
  });

  it('derives today for a timed value earlier today (day-granular)', () => {
    const timed = new Date(2026, 8, 28, 8, 0).toISOString();
    render(<DueDatePill dueDate={timed} today="2026-09-28" />);
    expect(rootOf().getAttribute('data-state')).toBe('today');
  });

  it('derives none for a malformed value, never overdue', () => {
    render(<DueDatePill dueDate="not-a-date" today="2026-09-28" />);
    const root = rootOf();
    expect(root.getAttribute('data-state')).toBe('none');
    expect(root.classList.contains('ui-due-pill--overdue')).toBe(false);
    expect(root.querySelector('time')).toBeNull();
  });

  it('merges className instead of replacing it', () => {
    render(<DueDatePill dueDate="2026-10-01" today="2026-09-28" className="legacy-hook" />);
    expect(rootOf().classList.contains('legacy-hook')).toBe(true);
    expect(rootOf().classList.contains('ui-due-pill')).toBe(true);
  });

  it('forwards an accessible label', () => {
    render(
      <DueDatePill dueDate="2026-10-01" today="2026-09-28" aria-label="Due 2026-10-01" />,
    );
    expect(screen.getByLabelText('Due 2026-10-01')).toBe(rootOf());
  });
});

describe('dueDateState', () => {
  it.each([
    [null, 'none'],
    ['', 'none'],
    ['not-a-date', 'none'],
    ['2026-02-31', 'none'],
    ['2026-09-27', 'overdue'],
    ['2026-09-28', 'today'],
    ['2026-09-29', 'later'],
  ] as const)('derives %s -> %s', (dueDate, expected) => {
    expect(dueDateState(dueDate, '2026-09-28')).toBe(expected);
  });
});
