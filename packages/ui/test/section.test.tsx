import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { Section, type SectionHeadingLevel } from '../src/components/section';
import type { StackGap } from '../src/components/stack';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

function cssBlock(selector: string): string {
  const css = readFileSync(join(__dirname, '..', 'src', 'styles', 'blocks.css'), 'utf8');
  return (
    (css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)) ??
      [])[1] ?? ''
  );
}

describe('Section', () => {
  it('renders a <section> landmark carrying the body', () => {
    render(
      <Section label="Today">
        <span data-testid="body">one</span>
      </Section>,
    );
    const section = document.querySelector('.ui-section')!;
    expect(section.tagName).toBe('SECTION');
    expect(classesOf(section)[0]).toBe('ui-section');
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

  it.each<[StackGap, string]>([
    ['sm', '--space-0-5'],
    ['md', '--space-1'],
    ['lg', '--space-2'],
  ])('composes a Stack body mapped through gap="%s" (%s)', (gap, token) => {
    render(<Section gap={gap}>x</Section>);
    const stack = document.querySelector('.ui-stack')!;
    expect(stack.tagName).toBe('DIV');
    expect(stack.classList.contains(`ui-stack--${gap}`)).toBe(true);
    expect(cssBlock(`.ui-stack--${gap}`)).toMatch(new RegExp(`gap:\\s*var\\(${token}\\)`));
  });

  it('defaults the body gap to md', () => {
    render(<Section>x</Section>);
    const stack = document.querySelector('.ui-stack')!;
    expect(stack.classList.contains('ui-stack--md')).toBe(true);
    expect(stack.classList.contains('ui-stack--sm')).toBe(false);
    expect(stack.classList.contains('ui-stack--lg')).toBe(false);
  });

  it('owns margin-block-start --space-2 while the heading owns margin-block-end --space-0-5', () => {
    const sectionCss = cssBlock('.ui-section');
    expect(sectionCss).toMatch(/margin-block-start:\s*var\(--space-2\)/);
    expect(cssBlock('.ui-section__heading')).toMatch(
      /margin-block-end:\s*var\(--space-0-5\)/,
    );
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
    render(
      <Section className="legacy-hook">
        x
      </Section>,
    );
    expect(classesOf(document.querySelector('.ui-section')!)).toEqual([
      'legacy-hook',
      'ui-section',
    ]);
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
