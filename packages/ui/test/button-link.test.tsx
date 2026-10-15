import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ButtonLink } from '../src/components/button-link';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('ButtonLink', () => {
  it('renders an anchor (never a button) carrying the button visuals by default', () => {
    render(<ButtonLink href="/meals/saved">Saved meals</ButtonLink>);
    const link = screen.getByRole('link', { name: 'Saved meals' });
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/meals/saved');
    expect(screen.queryByRole('button')).toBeNull();
    expect(classesOf(link)).toEqual(
      ['ui-btn', 'ui-btn--default', 'ui-btn--primary'].sort(),
    );
  });

  it('honors variant and size props on the same anchor', () => {
    render(
      <ButtonLink href="/meals/saved" variant="ghost" size="bare">
        Saved meals
      </ButtonLink>,
    );
    const link = screen.getByRole('link', { name: 'Saved meals' });
    expect(link.tagName).toBe('A');
    expect(classesOf(link)).toEqual(
      ['ui-btn', 'ui-btn--bare', 'ui-btn--ghost'].sort(),
    );
  });

  it('merges className instead of replacing it', () => {
    render(
      <ButtonLink href="/" className="legacy-hook">
        Go
      </ButtonLink>,
    );
    expect(classesOf(screen.getByRole('link'))).toEqual(
      ['legacy-hook', 'ui-btn', 'ui-btn--default', 'ui-btn--primary'].sort(),
    );
  });

  it('suppresses the anchor underline: the emitted .ui-btn base rule owns it', () => {
    const css = readFileSync(join(__dirname, '..', 'src', 'styles', 'atoms.css'), 'utf8');
    const block =
      (css.match(/\.ui-btn\s*\{([^}]*)\}/) ?? [])[1] ?? '';
    expect(block).toMatch(/text-decoration:\s*none/);
  });
});
