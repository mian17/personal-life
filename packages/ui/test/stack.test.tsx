import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { Stack, type StackAlign, type StackGap } from '../src/components/stack';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

const GAP_UTILITY: Record<StackGap, string> = {
  sm: 'gap-[var(--s1)]',
  md: 'gap-[var(--s2)]',
  lg: 'gap-[var(--s4)]',
};

const ALIGN_UTILITY: Record<Exclude<StackAlign, 'start'>, string> = {
  center: 'justify-items-center',
  end: 'justify-items-end',
};

describe('Stack', () => {
  it('renders its children in a ui-stack <div>', () => {
    render(
      <Stack>
        <span data-testid="a">one</span>
        <span data-testid="b">two</span>
      </Stack>,
    );
    const stack = document.querySelector('.ui-stack')!;
    expect(stack.tagName).toBe('DIV');
    expect(stack.classList.contains('ui-stack')).toBe(true);
    expect(stack.contains(screen.getByTestId('a'))).toBe(true);
    expect(stack.contains(screen.getByTestId('b'))).toBe(true);
  });

  it.each<[StackGap, string]>([
    ['sm', '--s1'],
    ['md', '--s2'],
    ['lg', '--s4'],
  ])('maps gap="%s" to the %s token utility', (gap, token) => {
    render(<Stack gap={gap}>x</Stack>);
    const stack = document.querySelector('.ui-stack')!;
    expect(stack.classList.contains(`ui-stack--${gap}`)).toBe(true);
    expect(stack.classList.contains(GAP_UTILITY[gap])).toBe(true);
    expect(GAP_UTILITY[gap]).toContain(`var(${token})`);
  });

  it('defaults the gap to md', () => {
    render(<Stack>x</Stack>);
    const stack = document.querySelector('.ui-stack')!;
    expect(stack.classList.contains('ui-stack--md')).toBe(true);
    expect(stack.classList.contains('ui-stack--sm')).toBe(false);
    expect(stack.classList.contains('ui-stack--lg')).toBe(false);
    expect(stack.classList.contains(GAP_UTILITY.md)).toBe(true);
  });

  it('defaults to no alignment class, leaving the grid at its own start', () => {
    render(<Stack>x</Stack>);
    const stack = document.querySelector('.ui-stack')!;
    expect(stack.classList.contains('ui-stack--center')).toBe(false);
    expect(stack.classList.contains('ui-stack--end')).toBe(false);
    expect(stack.classList.contains(ALIGN_UTILITY.center)).toBe(false);
    expect(stack.classList.contains(ALIGN_UTILITY.end)).toBe(false);
  });

  it.each<[StackAlign, string]>([
    ['center', 'center'],
    ['end', 'end'],
  ])('maps align="%s" to justify-items: %s', (align, justifyItems) => {
    render(<Stack align={align}>x</Stack>);
    const stack = document.querySelector('.ui-stack')!;
    expect(stack.classList.contains(`ui-stack--${align}`)).toBe(true);
    expect(stack.classList.contains(ALIGN_UTILITY[align as 'center' | 'end'])).toBe(true);
    expect(ALIGN_UTILITY[align as 'center' | 'end']).toContain(justifyItems);
  });

  it('lays out as a grid and adds no outer margin', () => {
    render(<Stack>x</Stack>);
    const classes = classesOf(document.querySelector('.ui-stack')!);
    expect(classes).toContain('grid');
    expect(classes.some((name) => name.startsWith('m-'))).toBe(false);
  });

  it('forwards role and aria-label verbatim (the New todo group contract)', () => {
    render(
      <Stack role="group" aria-label="New todo">
        x
      </Stack>,
    );
    const group = screen.getByRole('group', { name: 'New todo' });
    expect(group.classList.contains('ui-stack')).toBe(true);
    expect(group.tagName).toBe('DIV');
    expect(group.getAttribute('aria-label')).toBe('New todo');
  });

  it('merges className instead of replacing it', () => {
    render(<Stack className="legacy-hook">x</Stack>);
    expect(classesOf(document.querySelector('.ui-stack')!)).toEqual(
      expect.arrayContaining(['legacy-hook', 'ui-stack', 'ui-stack--md']),
    );
  });

  it('forwards a ref to the rendered div', () => {
    const ref = createRef<HTMLDivElement>();
    render(<Stack ref={ref}>x</Stack>);
    expect(ref.current).toBe(document.querySelector('.ui-stack'));
    expect(ref.current?.tagName).toBe('DIV');
  });
});
