import { render, screen } from '@testing-library/react';
import { PageTitle } from '../src/components/page-title';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

const DISPLAY_SIZE_UTILITY = 'text-[length:var(--fs-title)]';
const HEADING_MARGIN_UTILITY = 'm-[var(--s2)_0_var(--s4)]';

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

  it('renders the optional sub-line under the heading, quiet and one step below', () => {
    const { container } = render(<PageTitle sub="Across all five modules">Notes</PageTitle>);

    const heading = screen.getByRole('heading', { level: 1 });
    const sub = container.querySelector('p');
    if (!sub) throw new Error('no sub-line');
    expect(sub.textContent).toBe('Across all five modules');
    expect(heading.nextElementSibling).toBe(sub);
    expect(classesOf(sub)).toContain('ui-page-title__sub');
    expect(classesOf(sub)).toContain('text-[length:var(--fs-meta)]');
    expect(classesOf(sub)).toContain('text-ink-2');
    // The heading's own bottom step gives way to the sub-line's `--s1` gap.
    expect(classesOf(heading)).toContain('mb-0');
  });

  it('renders nothing extra when sub is omitted', () => {
    const { container } = render(<PageTitle>Notes</PageTitle>);
    expect(container.querySelector('p')).toBeNull();
    expect(classesOf(screen.getByRole('heading', { level: 1 }))).not.toContain('mb-0');
  });
});

describe('PageTitle — headingLevel and weight', () => {
  it('stays an <h1> with the page margins by default', () => {
    render(<PageTitle>Meditation</PageTitle>);
    const classes = classesOf(screen.getByRole('heading', { level: 1 }));
    expect(classes).toContain(HEADING_MARGIN_UTILITY);
    expect(classes).toContain('font-bold');
  });

  it('renders an h2 inside a panel and drops the page margins with the level', () => {
    render(<PageTitle headingLevel="h2">Session complete</PageTitle>);
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.tagName).toBe('H2');
    expect(heading.classList.contains(HEADING_MARGIN_UTILITY)).toBe(false);
    // The title tier itself does not move with the level.
    expect(classesOf(heading)).toContain(DISPLAY_SIZE_UTILITY);
    expect(classesOf(heading)).toContain('ui-page-title');
  });

  it('keeps the page margins on an h1 that carries a sub-line', () => {
    render(<PageTitle sub="One quiet line.">Meditation</PageTitle>);
    expect(classesOf(screen.getByRole('heading', { level: 1 }))).toContain(HEADING_MARGIN_UTILITY);
    expect(screen.getByText('One quiet line.')).toBeDefined();
  });

  it("selects the design's 600 weight instead of stacking it on the bold one", () => {
    render(<PageTitle weight="semibold">Meditation</PageTitle>);
    const classes = classesOf(screen.getByRole('heading', { level: 1 }));
    expect(classes).toContain('[font-weight:var(--fw-semibold)]');
    expect(classes).not.toContain('font-bold');
  });

  it('drops to 600 without losing the tier it sits in', () => {
    render(
      <PageTitle headingLevel="h2" weight="semibold">
        Session complete
      </PageTitle>,
    );
    const classes = classesOf(screen.getByRole('heading', { level: 2 }));
    expect(classes).toContain('tracking-[var(--tracking-title)]');
    expect(classes).toContain('leading-[var(--lh-title)]');
  });
});
