import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { Card } from '../src/components/card';

function cssBlock(selector: string): string {
  const css = readFileSync(join(__dirname, '..', 'src', 'styles', 'atoms.css'), 'utf8');
  return (
    (css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)) ??
      [])[1] ?? ''
  );
}

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

  it('defaults to no fill class, keeping the panel at its content height', () => {
    render(<Card>content</Card>);
    expect(classesOf(screen.getByText('content'))).toEqual(['ui-card']);
  });

  it('fill adds the full-height class and centres content in that box', () => {
    render(<Card fill>content</Card>);
    expect(classesOf(screen.getByText('content'))).toEqual(['ui-card', 'ui-card--fill']);
    // `safe` keeps an over-tall body scrollable from its first row instead of
    // clipping it above the scroll origin, where it could not be reached.
    expect(cssBlock('.ui-card--fill')).toMatch(/place-content:\s*safe center/);
    expect(cssBlock('.ui-card--fill')).toMatch(/display:\s*grid/);
    // The base card clips; the fill variant must scroll instead, or a body too
    // tall for a short viewport is unreachable.
    expect(cssBlock('.ui-card--fill')).toMatch(/overflow:\s*auto/);
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
