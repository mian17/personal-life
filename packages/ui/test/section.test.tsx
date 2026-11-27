import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { Section, type SectionHeadingLevel } from '../src/components/section';
import type { StackGap } from '../src/components/stack';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

const SECTION_UTILITY = 'mt-[var(--s6)]';
const AUTO_HIDE_UTILITY = '[&:has(.ui-list):not(:has(.ui-list-item))]:hidden';
const HEADING_MARGIN_UTILITY = '[&>:is(h2,h3)]:m-0';
const LABEL_GAP_UTILITY = 'mb-[var(--s2)]';

describe('Section', () => {
  it('renders a <section> landmark carrying the body', () => {
    render(
      <Section label="Today">
        <span data-testid="body">one</span>
      </Section>,
    );
    const section = document.querySelector('.ui-section')!;
    expect(section.tagName).toBe('SECTION');
    expect(classesOf(section)).toContain('ui-section');
    expect(section.contains(screen.getByTestId('body'))).toBe(true);
  });

  it('renders an h2 by default when labelled', () => {
    render(<Section label="Today">x</Section>);
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.tagName).toBe('H2');
    expect(heading.textContent).toBe('Today');
    expect(heading.classList.contains('ui-section__heading')).toBe(true);
  });

  it('renders the requested heading level', () => {
    render(
      <Section label="Lists" headingLevel="h3">
        x
      </Section>,
    );
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading.tagName).toBe('H3');
    expect(heading.textContent).toBe('Lists');
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });

  it('renders no heading when label is omitted, and still renders the body', () => {
    render(
      <Section>
        <span data-testid="body">x</span>
      </Section>,
    );
    expect(screen.queryByRole('heading')).toBeNull();
    expect(document.querySelector('.ui-section__heading')).toBeNull();
    expect(document.querySelector('.ui-section__heading-row')).toBeNull();
    expect(document.querySelector('.ui-stack')!.contains(screen.getByTestId('body'))).toBe(true);
  });

  it('renders the actions slot inside the heading row, trailing the label', () => {
    render(
      <Section
        label="Today"
        actions={
          <button type="button" data-testid="action">
            Edit
          </button>
        }
      >
        x
      </Section>,
    );
    const row = document.querySelector('.ui-section__heading-row')!;
    const heading = screen.getByRole('heading', { level: 2 });
    const action = screen.getByTestId('action');
    expect(row.contains(heading)).toBe(true);
    expect(row.contains(action)).toBe(true);
    expect(row.contains(document.querySelector('.ui-section__actions'))).toBe(true);
    expect(row.firstElementChild).toBe(heading);
  });

  it('renders the count at the heading row far end, styled per §8 `.slabel__count`', () => {
    render(
      <Section label="Items" count={3}>
        x
      </Section>,
    );
    const row = document.querySelector('.ui-section__heading-row')!;
    const count = document.querySelector('.ui-section__count')!;
    expect(row.contains(count)).toBe(true);
    expect(count.tagName).toBe('SPAN');
    expect(count.textContent).toBe('3');
    expect(row.lastElementChild).toBe(count);

    const classes = classesOf(count);
    expect(classes).toEqual(
      expect.arrayContaining([
        'text-[length:var(--fs-count)]',
        '[font-weight:var(--fw-semibold)]',
        'tracking-[var(--tracking-count)]',
        'normal-case',
        'text-ink-3',
        'ml-auto',
      ]),
    );
    // The label's uppercase treatment is scoped to the heading; the count never takes it.
    expect(classes).not.toContain('[&>:is(h2,h3)]:uppercase');
  });

  it('lets the count trail the label while the action keeps the far end', () => {
    render(
      <Section
        label="Items"
        count={3}
        actions={
          <button type="button" data-testid="action">
            Add item
          </button>
        }
      >
        x
      </Section>,
    );
    const row = document.querySelector('.ui-section__heading-row')!;
    const heading = screen.getByRole('heading', { level: 2 });
    const count = document.querySelector('.ui-section__count')!;
    const actions = document.querySelector('.ui-section__actions')!;
    expect(Array.from(row.children)).toEqual([heading, count, actions]);
    expect(count.classList.contains('ml-auto')).toBe(false);
    expect(actions.classList.contains('ml-auto')).toBe(true);
  });

  it('renders no count element when count is absent, leaving the row as before', () => {
    render(
      <Section label="Today" actions={<button type="button">Edit</button>}>
        x
      </Section>,
    );
    expect(document.querySelector('.ui-section__count')).toBeNull();
    expect(Array.from(document.querySelector('.ui-section__heading-row')!.children)).toEqual([
      screen.getByRole('heading', { level: 2 }),
      document.querySelector('.ui-section__actions'),
    ]);
  });

  it('renders no count element without a label', () => {
    render(<Section count={3}>x</Section>);
    expect(document.querySelector('.ui-section__count')).toBeNull();
    expect(document.querySelector('.ui-section__heading-row')).toBeNull();
  });

  it('styles the count through tokens only and renders any node', () => {
    render(
      <Section label="Items" count={<strong>3</strong>}>
        x
      </Section>,
    );
    const count = document.querySelector('.ui-section__count')!;
    expect(count.querySelector('strong')!.textContent).toBe('3');
    expect(classesOf(count).join(' ')).not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(|\d+px|\d+rem/);
  });

  it.each<[StackGap, string]>([
    ['sm', '--s1'],
    ['md', '--s2'],
    ['lg', '--s4'],
  ])('composes a Stack body mapped through gap="%s" (%s)', (gap, token) => {
    render(<Section gap={gap}>x</Section>);
    const stack = document.querySelector('.ui-stack')!;
    expect(stack.tagName).toBe('DIV');
    expect(stack.classList.contains(`ui-stack--${gap}`)).toBe(true);
    expect(stack.classList.contains(`gap-[var(${token})]`)).toBe(true);
  });

  it('defaults the body gap to md', () => {
    render(<Section>x</Section>);
    const stack = document.querySelector('.ui-stack')!;
    expect(stack.classList.contains('ui-stack--md')).toBe(true);
    expect(stack.classList.contains('ui-stack--sm')).toBe(false);
    expect(stack.classList.contains('ui-stack--lg')).toBe(false);
  });

  it('owns the outer --s6 rhythm while the label owns its own --s2 gap', () => {
    render(<Section label="Today">x</Section>);
    expect(classesOf(document.querySelector('.ui-section')!)).toContain(SECTION_UTILITY);

    // §8's `.slabel`: the small-caps treatment rides the heading row's children, so the
    // heading keeps its own hook alone and no type utility is pinned on it directly.
    const rowClasses = classesOf(document.querySelector('.ui-section__heading-row')!);
    expect(rowClasses).toContain(HEADING_MARGIN_UTILITY);
    expect(rowClasses).toContain(LABEL_GAP_UTILITY);
    expect(rowClasses).toContain('[&>:is(h2,h3)]:uppercase');
    expect(rowClasses).toContain('[&>:is(h2,h3)]:text-[length:var(--fs-section-label)]');

    // A section without a label carries no label gap: the utility only exists on the row.
    expect(classesOf(document.querySelector('.ui-section')!)).not.toContain(LABEL_GAP_UTILITY);
  });

  it('collapses a group section whose every row was removed', () => {
    render(
      <Section label="Today">
        <ul className="ui-list" />
      </Section>,
    );
    expect(classesOf(document.querySelector('.ui-section')!)).toContain(AUTO_HIDE_UTILITY);
  });

  it('gives the heading no interactive semantics of its own', () => {
    render(<Section label="Today">x</Section>);
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.hasAttribute('tabindex')).toBe(false);
    expect(heading.hasAttribute('role')).toBe(false);
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelector('a')).toBeNull();
  });

  it('merges className instead of replacing it', () => {
    render(<Section className="legacy-hook">x</Section>);
    const classes = classesOf(document.querySelector('.ui-section')!);
    expect(classes).toContain('ui-section');
    expect(classes).toContain('legacy-hook');
  });

  it('forwards a ref to the rendered section', () => {
    const ref = createRef<HTMLElement>();
    render(<Section ref={ref}>x</Section>);
    expect(ref.current).toBe(document.querySelector('.ui-section'));
    expect(ref.current?.tagName).toBe('SECTION');
  });

  it('forwards arbitrary attributes verbatim', () => {
    render(
      <Section aria-label="group" data-extra="1">
        x
      </Section>,
    );
    const section = document.querySelector('.ui-section')!;
    expect(section.getAttribute('aria-label')).toBe('group');
    expect(section.getAttribute('data-extra')).toBe('1');
  });
});

// The heading-level union is part of the public contract.
const _levels: SectionHeadingLevel[] = ['h2', 'h3'];
void _levels;

describe('Section — margin and labelTone', () => {
  it('keeps its own --s6 top margin by default, so every shipped section is unchanged', () => {
    render(<Section label="Today">x</Section>);
    expect(classesOf(document.querySelector('.ui-section')!)).toContain(SECTION_UTILITY);
  });

  it('drops the top margin inside a sheet body, where the Stack supplies the rhythm', () => {
    render(
      <Section label="Start after" margin={false}>
        x
      </Section>,
    );
    const classes = classesOf(document.querySelector('.ui-section')!);
    expect(classes).toContain('ui-section');
    expect(classes).not.toContain(SECTION_UTILITY);
  });

  it('keeps the second ink tier on the heading row by default', () => {
    render(<Section label="Today">x</Section>);
    const row = classesOf(document.querySelector('.ui-section__heading-row')!);
    expect(row).toContain('[&>:is(h2,h3)]:text-ink-2');
    expect(row).not.toContain('[&>:is(h2,h3)]:text-ink-3');
  });

  it('selects the quieter label tier instead of stacking a second ink on the same row', () => {
    render(
      <Section label="Repeat" labelTone="ink-3">
        x
      </Section>,
    );
    const row = classesOf(document.querySelector('.ui-section__heading-row')!);
    expect(row).toContain('[&>:is(h2,h3)]:text-ink-3');
    expect(row).not.toContain('[&>:is(h2,h3)]:text-ink-2');
    // The label treatment itself is untouched: one tier of ink moved, nothing else.
    expect(row).toContain('[&>:is(h2,h3)]:uppercase');
    expect(row).toContain('[&>:is(h2,h3)]:tracking-[var(--tracking-section-label)]');
  });
});
