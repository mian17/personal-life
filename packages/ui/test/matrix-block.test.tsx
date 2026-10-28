import { render, screen } from '@testing-library/react';
import { MatrixBlock, type MatrixQuadrant } from '../src/components/matrix-block';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
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
    expect(classesOf(root)).toEqual(expect.arrayContaining(['legacy-hook', 'ui-matrix']));
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
    // The tint rides the heading, so the section carries the hook and the label the colour.
    expect(sections[0].classList.contains('ui-matrix__quadrant--danger')).toBe(true);
    expect(sections[0].querySelector('.ui-matrix__label')!.classList.contains('text-danger')).toBe(
      true,
    );
    expect(sections[1].classList.contains('ui-matrix__quadrant--danger')).toBe(false);
    expect(sections[1].querySelector('.ui-matrix__label')!.className).not.toMatch(
      /text-(danger|amber|accent|green)/,
    );
  });

  // jsdom never applies stylesheets, so the layout contract is read off the classes
  // the block carries: these are the utilities a browser turns into the 2×2 grid.
  it('is a 2×2 grid of muted panels at every width, unconditionally (tokens only)', () => {
    render(<MatrixBlock quadrants={quadrants} />);
    const matrix = document.querySelector('.ui-matrix')!;
    expect(matrix.classList.contains('grid')).toBe(true);
    expect(matrix.classList.contains('grid-cols-[repeat(2,minmax(0,1fr))]')).toBe(true);
    // Equal-height rows, bounded so overflowing content scrolls instead of growing
    // the matrix: `minmax(0, 1fr)`, never a bare `1fr` (= minmax(auto, 1fr)).
    expect(matrix.classList.contains('auto-rows-[minmax(0,1fr)]')).toBe(true);
    expect(matrix.classList.contains('gap-[var(--space-0-5)]')).toBe(true);
    // No outer frame on the grid itself.
    expect(matrix.classList.contains('border')).toBe(false);

    const quadrant = document.querySelector('.ui-matrix__quadrant')!;
    expect(quadrant.classList.contains('flex')).toBe(true);
    expect(quadrant.classList.contains('flex-col')).toBe(true);
    expect(quadrant.classList.contains('gap-[var(--space-0-5)]')).toBe(true);
    expect(quadrant.classList.contains('p-[var(--space-1)]')).toBe(true);
    expect(quadrant.classList.contains('min-h-[var(--space-5)]')).toBe(true);
    // A muted panel surface, separated from its siblings by the grid gap.
    expect(quadrant.classList.contains('bg-panel')).toBe(true);
    expect(quadrant.classList.contains('rounded-[var(--radius-lg)]')).toBe(true);
    // Overflowing content scrolls inside the box; the heading stays put.
    expect(quadrant.classList.contains('max-h-full')).toBe(true);
    expect(quadrant.classList.contains('overflow-hidden')).toBe(true);

    const label = document.querySelector('.ui-matrix__label')!;
    expect(label.classList.contains('m-0')).toBe(true);
    expect(label.classList.contains('truncate')).toBe(true);

    const items = document.querySelector('.ui-matrix__items')!;
    expect(items.classList.contains('grid')).toBe(true);
    expect(items.classList.contains('gap-[var(--space-0-25)]')).toBe(true);
    expect(items.classList.contains('flex-1')).toBe(true);
    expect(items.classList.contains('min-h-0')).toBe(true);
    expect(items.classList.contains('overflow-y-auto')).toBe(true);

    // Guard: every class resolves through utilities or tokens, never a raw px/hex/rgb value.
    const classes = `${matrix.className} ${quadrant.className} ${label.className} ${items.className}`;
    expect(classes).not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(/);
    expect(classes).not.toMatch(/\b\d+(?:\.\d+)?px\b/);
  });

  it('tints the heading through a token colour utility per tone', () => {
    const tones = ['danger', 'amber', 'accent', 'green'] as const;
    for (const tone of tones) {
      const { unmount } = render(
        <MatrixBlock quadrants={[{ id: tone, label: tone, items: <span>{tone}</span>, tone }]} />,
      );
      expect(document.querySelector('.ui-matrix__label')!.classList.contains(`text-${tone}`)).toBe(
        true,
      );
      unmount();
    }
  });

  it('centres the empty slot in muted copy', () => {
    render(<MatrixBlock quadrants={[{ id: 'empty', label: 'Empty', items: null, empty: 'No tasks' }]} />);
    const empty = document.querySelector('.ui-matrix__empty')!;
    expect(empty.classList.contains('text-muted')).toBe(true);
    expect(empty.classList.contains('place-content-center')).toBe(true);
  });
});
