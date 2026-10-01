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

  it('renders a labelled section with the empty slot when items is null', () => {
    render(<MatrixBlock quadrants={[{ id: 'empty', label: 'Empty', items: null, empty: 'No tasks' }]} />);
    const section = document.querySelector('.ui-matrix__quadrant')!;
    expect(section.querySelector('.ui-matrix__label')!.textContent).toBe('Empty');
    expect(section.querySelector('.ui-matrix__empty')!.textContent).toBe('No tasks');
    expect(section.querySelector('.ui-matrix__items')).toBeNull();
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

  it('tints a toned quadrant heading and leaves an untinted one unmodified', () => {
    render(
      <MatrixBlock
        quadrants={[
          { id: 'q1', label: 'One', items: <span>first</span>, tone: 'danger' },
          { id: 'q2', label: 'Two', items: <span>second</span> },
        ]}
      />,
    );
    const sections = Array.from(document.querySelectorAll('.ui-matrix__quadrant'));
    expect(classesOf(sections[0])).toEqual(['ui-matrix__quadrant', 'ui-matrix__quadrant--danger']);
    expect(classesOf(sections[1])).toEqual(['ui-matrix__quadrant']);
  });

  it('is a 2×2 grid of muted panels at every width, unconditionally (tokens only)', () => {
    // The 2×2 layout is unconditional — there is no phone/media variant.
    const matrix = cssBlock('.ui-matrix');
    expect(matrix).toMatch(/display:\s*grid/);
    expect(matrix).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    // Equal-height rows: the two rows share the same height so empty quadrants match.
    expect(matrix).toMatch(/grid-auto-rows:\s*1fr/);
    expect(matrix).toMatch(/gap:\s*var\(--space-0-5\)/);
    // No outer frame on the grid itself.
    expect(matrix).not.toMatch(/border/);

    const quadrant = cssBlock('.ui-matrix__quadrant');
    expect(quadrant).toMatch(/display:\s*flex/);
    expect(quadrant).toMatch(/flex-direction:\s*column/);
    expect(quadrant).toMatch(/gap:\s*var\(--space-0-5\)/);
    expect(quadrant).toMatch(/padding:\s*var\(--space-1\)/);
    expect(quadrant).toMatch(/min-height:\s*var\(--space-5\)/);
    // A muted panel surface, separated from its siblings by the grid gap.
    expect(quadrant).toMatch(/background:\s*var\(--panel\)/);
    expect(quadrant).toMatch(/border-radius:\s*var\(--radius-lg\)/);

    expect(cssBlock('.ui-matrix__label')).toMatch(/margin:\s*0/);
    expect(cssBlock('.ui-matrix__label')).toMatch(/white-space:\s*nowrap/);
    expect(cssBlock('.ui-matrix__label')).toMatch(/overflow:\s*hidden/);
    expect(cssBlock('.ui-matrix__label')).toMatch(/text-overflow:\s*ellipsis/);

    // Overflowing content scrolls inside the box; the heading stays put.
    expect(quadrant).toMatch(/max-height:\s*100%/);
    expect(quadrant).toMatch(/overflow:\s*hidden/);
    const items = cssBlock('.ui-matrix__items');
    expect(items).toMatch(/display:\s*grid/);
    expect(items).toMatch(/flex:\s*1/);
    expect(items).toMatch(/min-height:\s*0/);
    expect(items).toMatch(/overflow-y:\s*auto/);

    // Heading tint per quadrant tone (token colours only).
    expect(cssBlock('.ui-matrix__quadrant--danger .ui-matrix__label')).toMatch(
      /color:\s*var\(--danger\)/,
    );
    expect(cssBlock('.ui-matrix__quadrant--amber .ui-matrix__label')).toMatch(
      /color:\s*var\(--amber\)/,
    );
    expect(cssBlock('.ui-matrix__quadrant--accent .ui-matrix__label')).toMatch(
      /color:\s*var\(--accent\)/,
    );
    expect(cssBlock('.ui-matrix__quadrant--green .ui-matrix__label')).toMatch(
      /color:\s*var\(--green\)/,
    );

    const empty = cssBlock('.ui-matrix__empty');
    expect(empty).toMatch(/color:\s*var\(--muted\)/);
    expect(empty).toMatch(/place-content:\s*center/);

    // Not media-gated: no 640px media block carries a `.ui-matrix*` rule.
    expect(/@media[^{]*640px[^{]*\{[^@]*\.ui-matrix/.test(css)).toBe(false);

    // Guard: the matrix declarations resolve through tokens, never raw px/hex.
    const toneRules =
      cssBlock('.ui-matrix__quadrant--danger .ui-matrix__label') +
      cssBlock('.ui-matrix__quadrant--amber .ui-matrix__label') +
      cssBlock('.ui-matrix__quadrant--accent .ui-matrix__label') +
      cssBlock('.ui-matrix__quadrant--green .ui-matrix__label');
    const declarations = `${matrix}${quadrant}${items}${toneRules}${empty}`;
    expect(declarations).not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(/);
    expect(declarations).not.toMatch(/\b\d+(?:\.\d+)?px\b/);
  });
});
