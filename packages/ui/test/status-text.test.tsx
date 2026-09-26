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
    expect(classesOf(screen.getByRole('status'))).toEqual(['ui-status-text']);
  });

  it('merges className instead of replacing it', () => {
    render(<StatusText className="legacy-hook">x</StatusText>);
    expect(classesOf(screen.getByRole('status'))).toEqual(['legacy-hook', 'ui-status-text']);
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
