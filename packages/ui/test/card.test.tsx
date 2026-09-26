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
    expect(classesOf(card)).toEqual(['ui-card']);
  });

  it('merges className instead of replacing it', () => {
    render(<Card className="legacy-hook">content</Card>);
    expect(classesOf(screen.getByText('content'))).toEqual(['legacy-hook', 'ui-card']);
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
