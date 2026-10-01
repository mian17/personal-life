import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MatrixBlock, type MatrixQuadrant } from '../src/components/matrix-block';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

const css = readFileSync(join(__dirname, '..', 'src', 'styles', 'blocks.css'), 'utf8');

function cssBlock(selector: string): string {
  return (
    (css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)) ??
      [])[1] ?? ''
  );
}

const quadrants: MatrixQuadrant[] = [
  { id: 'q1', label: 'One', items: <span data-testid="i1">first</span> },
  { id: 'q2', label: 'Two', items: <span data-testid="i2">second</span> },
  { id: 'q3', label: 'Three', items: <span data-testid="i3">third</span> },
  { id: 'q4', label: 'Four', items: <span data-testid="i4">fourth</span> },
];

describe('MatrixBlock', () => {
  it('renders one section per quadrant, in the given order', () => {
    render(<MatrixBlock quadrants={quadrants} />);
    const sections = Array.from(document.querySelectorAll('.ui-matrix__quadrant'));
    expect(sections).toHaveLength(4);
    expect(sections.map((s) => s.tagName)).toEqual(['SECTION', 'SECTION', 'SECTION', 'SECTION']);
    expect(sections.map((s) => s.querySelector('.ui-matrix__label')!.textContent)).toEqual([
      'One',
      'Two',
      'Three',
      'Four',
    ]);
    expect(document.querySelector('.ui-matrix')!.children).toHaveLength(4);
  });

  it('renders the label as the quadrant heading', () => {
    render(<MatrixBlock quadrants={quadrants} />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Three' });
    expect(heading.tagName).toBe('H2');
    expect(heading.classList.contains('ui-matrix__label')).toBe(true);
  });

  it('renders items verbatim inside the quadrant', () => {
    render(<MatrixBlock quadrants={quadrants} />);
    expect(screen.getByTestId('i1').textContent).toBe('first');
    const items = document.querySelector('.ui-matrix__items')!;
    expect(items.contains(screen.getByTestId('i1'))).toBe(true);
  });

  it('renders a labelled section even when items is empty', () => {
    render(<MatrixBlock quadrants={[{ id: 'empty', label: 'Empty', items: null }]} />);
    const section = document.querySelector('.ui-matrix__quadrant')!;
    expect(section.querySelector('.ui-matrix__label')!.textContent).toBe('Empty');
    expect(section.querySelector('.ui-matrix__items')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Empty' })).toBeTruthy();
  });

  it('merges className onto the container instead of replacing it', () => {
    render(<MatrixBlock quadrants={quadrants} className="legacy-hook" />);
    const root = document.querySelector('.ui-matrix')!;
    expect(root.tagName).toBe('DIV');
    expect(classesOf(root)).toEqual(['legacy-hook', 'ui-matrix']);
  });

  it('is presentational: no interactive elements of its own', () => {
    render(<MatrixBlock quadrants={quadrants} />);
    expect(document.querySelector('.ui-matrix a')).toBeNull();
    expect(document.querySelector('.ui-matrix button')).toBeNull();
  });

  it('stacks one column by default and two at the 640px breakpoint (tokens only)', () => {
    const matrix = cssBlock('.ui-matrix');
    expect(matrix).toMatch(/display:\s*grid/);
    expect(matrix).toMatch(/gap:\s*0/);
    // No outer frame on the grid itself.
    expect(matrix).not.toMatch(/border/);

    const quadrant = cssBlock('.ui-matrix__quadrant');
    expect(quadrant).toMatch(/display:\s*grid/);
    expect(quadrant).toMatch(/gap:\s*var\(--space-0-5\)/);
    expect(quadrant).toMatch(/padding:\s*var\(--space-1\)/);
    expect(quadrant).toMatch(/min-height:\s*var\(--space-5\)/);

    // Phone (one column): a hairline between consecutive quadrants, never above the first.
    const stacked = cssBlock('.ui-matrix__quadrant + .ui-matrix__quadrant');
    expect(stacked).toMatch(/border-top:\s*var\(--border-width\)\s+solid\s+var\(--border\)/);

    expect(cssBlock('.ui-matrix__label')).toMatch(/margin:\s*0/);
    expect(cssBlock('.ui-matrix__items')).toMatch(/display:\s*grid/);

    const media = css.match(/@media\s*\(min-width:\s*640px\)\s*\{([\s\S]*?)\}\s*\}/)?.[1] ?? '';
    expect(media).toMatch(/\.ui-matrix\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    // Equal-height rows: the two auto rows share the same height in the 2×2 layout.
    expect(media).toMatch(/\.ui-matrix\s*\{[^}]*grid-auto-rows:\s*1fr/);
    // 2×2 inner cross: reset the phone rule, then re-add between the rows/columns.
    expect(media).toMatch(/\.ui-matrix__quadrant \+ \.ui-matrix__quadrant\s*\{[^}]*border-top:\s*0/);
    expect(media).toMatch(
      /\.ui-matrix__quadrant:nth-child\(n \+ 3\)\s*\{[^}]*border-top:\s*var\(--border-width\)\s+solid\s+var\(--border\)/,
    );
    expect(media).toMatch(
      /\.ui-matrix__quadrant:nth-child\(odd\)\s*\{[^}]*border-right:\s*var\(--border-width\)\s+solid\s+var\(--border\)/,
    );

    // Guard: divider declarations resolve through tokens, never raw px/hex.
    const declarations = `${matrix}${quadrant}${stacked}${media}`;
    expect(declarations).not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(/);
    expect(declarations).not.toMatch(/\b\d+(?:\.\d+)?px\b/);
  });
});
