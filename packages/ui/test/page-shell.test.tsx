import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { PageShell } from '../src/components/page-shell';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('PageShell', () => {
  it('renders a <main> landmark with the ui-page class', () => {
    render(<PageShell>content</PageShell>);
    const main = screen.getByRole('main');
    expect(main.tagName).toBe('MAIN');
    expect(classesOf(main)).toContain('ui-page');
  });

  // jsdom never applies stylesheets, so the page column is read off the classes it carries.
  it('takes its width, centring and safe-area padding from utilities rather than a stylesheet rule', () => {
    render(<PageShell>content</PageShell>);
    const classes = classesOf(screen.getByRole('main'));
    expect(classes).toContain('max-w-[var(--frame-max)]');
    expect(classes).toContain('mx-auto');
    expect(classes).toContain('px-[var(--s4)]');
    expect(classes).toContain('pt-[var(--s4)]');
    expect(classes).toContain('pb-[calc(var(--fab-size)+var(--s8)+env(safe-area-inset-bottom))]');
  });

  it('renders its children inside the landmark', () => {
    render(
      <PageShell>
        <span data-testid="inner">nested</span>
      </PageShell>,
    );
    expect(screen.getByTestId('inner')).toBeTruthy();
    expect(screen.getByRole('main').contains(screen.getByTestId('inner'))).toBe(true);
  });

  it('merges className instead of replacing it', () => {
    render(<PageShell className="legacy-hook">content</PageShell>);
    expect(classesOf(screen.getByRole('main'))).toEqual(
      expect.arrayContaining(['legacy-hook', 'ui-page']),
    );
  });

  it('forwards arbitrary attributes and a ref', () => {
    const ref = createRef<HTMLElement>();
    render(
      <PageShell ref={ref} data-extra="1" aria-label="page">
        content
      </PageShell>,
    );
    const main = screen.getByRole('main');
    expect(main.getAttribute('data-extra')).toBe('1');
    expect(main.getAttribute('aria-label')).toBe('page');
    expect(ref.current).toBe(main);
  });
});
