import { render, screen } from '@testing-library/react';
import { SubNav } from '../src/components/sub-nav';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('SubNav', () => {
  it('draws the row as a named <nav> landmark', () => {
    render(<SubNav backHref="/meals/settings" backLabel="Meals" />);

    const nav = screen.getByRole('navigation', { name: 'Back to Meals' });
    expect(nav.tagName).toBe('NAV');
    expect(classesOf(nav)).toContain('ui-sub-nav');
  });

  it('routes back through a real anchor: literal href, visible label as its name', () => {
    render(<SubNav backHref="/meals/settings" backLabel="Meals" />);

    const back = screen.getByRole('link', { name: 'Meals' });
    expect(back.tagName).toBe('A');
    expect(back.getAttribute('href')).toBe('/meals/settings');
    expect(back.textContent).toBe('Meals');
    // A `next/link` route, not a raw anchor and not a click handler.
    expect(back.hasAttribute('data-next-link')).toBe(true);
  });

  it('reads the screen name back only when a status is given', () => {
    const { rerender } = render(<SubNav backHref="/meals/settings" backLabel="Meals" />);
    expect(screen.queryByText('Daily target')).toBeNull();

    rerender(<SubNav backHref="/meals/settings" backLabel="Meals" status="Daily target" />);
    const status = screen.getByText('Daily target');
    expect(status.tagName).toBe('SPAN');
    expect(classesOf(status)).toContain('ui-sub-nav__status');
    expect(classesOf(status)).toContain('ml-auto');
  });

  it('takes its lengths from the token scale, never a raw value', () => {
    render(<SubNav backHref="/meals/settings" backLabel="Meals" status="Daily target" />);

    const classes = [screen.getByRole('navigation'), screen.getByRole('link', { name: 'Meals' })]
      .flatMap(classesOf)
      .join(' ');
    expect(classes).toContain('min-h-[var(--tap)]');
    expect(classes).toContain('gap-[var(--s2)]');
    expect(classes).toContain('text-[length:var(--fs-row-title)]');
    expect(classes).not.toMatch(/\d+(px|rem)/);
    expect(classes).not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(/);
    expect(document.querySelector('[style]')).toBeNull();
  });

  it('merges className and forwards nav attributes', () => {
    render(
      <SubNav
        backHref="/meals/settings"
        backLabel="Meals"
        className="legacy-hook"
        aria-label="Target actions"
        data-extra="1"
      />,
    );

    // A caller-supplied landmark name wins over the derived one.
    const nav = screen.getByRole('navigation', { name: 'Target actions' });
    expect(classesOf(nav)).toContain('legacy-hook');
    expect(classesOf(nav)).toContain('ui-sub-nav');
    expect(nav.getAttribute('data-extra')).toBe('1');
  });
});
