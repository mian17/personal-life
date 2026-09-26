import { render, screen } from '@testing-library/react';
import { PageTitle } from '../src/components/page-title';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('PageTitle', () => {
  it('renders an <h1> heading with the ui-page-title class', () => {
    render(<PageTitle>Notes</PageTitle>);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.tagName).toBe('H1');
    expect(classesOf(heading)).toEqual(['ui-page-title']);
  });

  it('renders its children verbatim as the heading text', () => {
    render(<PageTitle>Trash</PageTitle>);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Trash');
  });

  it('merges className instead of replacing it', () => {
    render(<PageTitle className="legacy-hook">Notes</PageTitle>);
    expect(classesOf(screen.getByRole('heading', { level: 1 }))).toEqual([
      'legacy-hook',
      'ui-page-title',
    ]);
  });

  it('forwards arbitrary attributes', () => {
    render(<PageTitle data-extra="1">Notes</PageTitle>);
    expect(screen.getByRole('heading', { level: 1 }).getAttribute('data-extra')).toBe('1');
  });
});
