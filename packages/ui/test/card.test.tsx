import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { Card } from '../src/components/card';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('Card', () => {
  it('renders a <div> with the ui-card surface class', () => {
    render(<Card>content</Card>);
    const card = screen.getByText('content');
    expect(card.tagName).toBe('DIV');
    expect(card.classList.contains('ui-card')).toBe(true);
  });

  it('paints the panel surface from token utilities', () => {
    render(<Card>content</Card>);
    const card = screen.getByText('content');
    expect(card.classList.contains('bg-panel')).toBe(true);
    expect(card.classList.contains('border-border')).toBe(true);
    expect(card.classList.contains('rounded-[var(--radius-lg)]')).toBe(true);
  });

  it('merges className instead of replacing it', () => {
    render(<Card className="legacy-hook">content</Card>);
    expect(classesOf(screen.getByText('content'))).toEqual(
      expect.arrayContaining(['legacy-hook', 'ui-card']),
    );
  });

  it('defaults to no fill class, keeping the panel at its content height', () => {
    render(<Card>content</Card>);
    const card = screen.getByText('content');
    expect(card.classList.contains('ui-card--fill')).toBe(false);
    expect(card.classList.contains('overflow-hidden')).toBe(true);
  });

  it('fill adds the full-height class and centres content in that box', () => {
    render(<Card fill>content</Card>);
    const card = screen.getByText('content');
    expect(card.classList.contains('ui-card--fill')).toBe(true);
    // `safe` keeps an over-tall body scrollable from its first row instead of
    // clipping it above the scroll origin, where it could not be reached.
    expect(card.classList.contains('place-content-center-safe')).toBe(true);
    expect(card.classList.contains('grid')).toBe(true);
    // The base card clips; the fill variant must scroll instead, or a body too
    // tall for a short viewport is unreachable.
    expect(card.classList.contains('overflow-auto')).toBe(true);
    expect(card.classList.contains('overflow-hidden')).toBe(false);
  });

  it('renders arbitrary children', () => {
    render(
      <Card>
        <span data-testid="inner">nested</span>
      </Card>,
    );
    expect(screen.getByTestId('inner')).toBeTruthy();
  });

  it('forwards arbitrary attributes and a ref', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <Card ref={ref} data-extra="1" aria-label="panel">
        content
      </Card>,
    );
    const card = screen.getByText('content');
    expect(card.getAttribute('data-extra')).toBe('1');
    expect(card.getAttribute('aria-label')).toBe('panel');
    expect(ref.current).toBe(card);
  });
});
