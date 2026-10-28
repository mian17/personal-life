import { render, screen } from '@testing-library/react';
import { PageTitle } from '../src/components/page-title';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

const DISPLAY_SIZE_UTILITY = 'text-[length:var(--space-2)]';
const HEADING_MARGIN_UTILITY = 'm-[0_0_var(--space-1)]';

describe('PageTitle', () => {
  it('renders an <h1> heading with the ui-page-title hook', () => {
    render(<PageTitle>Notes</PageTitle>);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.tagName).toBe('H1');
    expect(classesOf(heading)).toContain('ui-page-title');
  });

  it('sets the display size off the frozen token scale', () => {
    render(<PageTitle>Notes</PageTitle>);
    const classes = classesOf(screen.getByRole('heading', { level: 1 }));
    expect(classes).toContain(DISPLAY_SIZE_UTILITY);
    expect(classes).toContain(HEADING_MARGIN_UTILITY);
  });

  it('renders its children verbatim as the heading text', () => {
    render(<PageTitle>Trash</PageTitle>);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Trash');
  });

  it('merges className instead of replacing it', () => {
    render(<PageTitle className="legacy-hook">Notes</PageTitle>);
    const classes = classesOf(screen.getByRole('heading', { level: 1 }));
    expect(classes).toContain('legacy-hook');
    expect(classes).toContain('ui-page-title');
  });

  it('forwards arbitrary attributes', () => {
    render(<PageTitle data-extra="1">Notes</PageTitle>);
    expect(screen.getByRole('heading', { level: 1 }).getAttribute('data-extra')).toBe('1');
  });
});
