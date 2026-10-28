import { render, screen } from '@testing-library/react';
import { StatusText } from '../src/components/status-text';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('StatusText', () => {
  it('renders a <span role="status" aria-live="polite">', () => {
    render(<StatusText>Saving…</StatusText>);
    const status = screen.getByRole('status');
    expect(status.tagName).toBe('SPAN');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('Saving…');
  });

  it('uses the ui-status-text class', () => {
    render(<StatusText>Saving…</StatusText>);
    expect(classesOf(screen.getByRole('status'))).toContain('ui-status-text');
  });

  it('merges className instead of replacing it', () => {
    render(<StatusText className="legacy-hook">x</StatusText>);
    const classes = classesOf(screen.getByRole('status'));
    expect(classes).toContain('legacy-hook');
    expect(classes).toContain('ui-status-text');
  });

  it('adds the display modifier for size="display" and keeps role/aria-live', () => {
    render(<StatusText size="display">25:00</StatusText>);
    const status = screen.getByRole('status');
    expect(status.tagName).toBe('SPAN');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('25:00');
    expect(classesOf(status)).toContain('ui-status-text--display');
  });

  it('renders no display modifier when size is omitted or default', () => {
    render(<StatusText>25:00</StatusText>);
    render(<StatusText size="default">25:00</StatusText>);
    const [omitted, explicitDefault] = screen.getAllByRole('status');
    expect(classesOf(omitted)).toContain('ui-status-text');
    expect(classesOf(explicitDefault)).toContain('ui-status-text');
    expect(classesOf(omitted)).not.toContain('ui-status-text--display');
    expect(classesOf(explicitDefault)).not.toContain('ui-status-text--display');
  });

  it('lets a caller override aria-live', () => {
    render(
      <StatusText size="display" aria-live="off">
        25:00
      </StatusText>,
    );
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('off');
  });

  it('reserves its height while invisible (invisible, never display:none)', () => {
    render(<StatusText invisible>Next: Short break</StatusText>);
    const status = screen.getByRole('status');
    expect(status.classList.contains('ui-invisible')).toBe(true);
    expect(status.textContent).toBe('Next: Short break');

    // The utility is the rule that makes it safe: `invisible` hides the paint and
    // keeps the box. `hidden` would collapse it, and the caller is hiding the line
    // precisely to stop the layout moving.
    const classes = classesOf(status);
    expect(classes).toContain('invisible');
    expect(classes).not.toContain('hidden');
  });

  it('forwards arbitrary attributes', () => {
    render(
      <StatusText className="x" data-extra="1">
        x
      </StatusText>,
    );
    expect(screen.getByRole('status').getAttribute('data-extra')).toBe('1');
  });
});
