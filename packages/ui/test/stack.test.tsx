import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { Stack, type StackAlign, type StackGap } from '../src/components/stack';

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
    expect(classesOf(stack)[0]).toBe('ui-stack');
    expect(stack.contains(screen.getByTestId('a'))).toBe(true);
    expect(stack.contains(screen.getByTestId('b'))).toBe(true);
  });

  it.each<[StackGap, string]>([
    ['sm', '--space-0-5'],
    ['md', '--space-1'],
    ['lg', '--space-2'],
  ])('maps gap="%s" to the %s token', (gap, token) => {
    render(<Stack gap={gap}>x</Stack>);
    const stack = document.querySelector('.ui-stack')!;
    expect(stack.classList.contains(`ui-stack--${gap}`)).toBe(true);
    expect(cssBlock(`.ui-stack--${gap}`)).toMatch(new RegExp(`gap:\\s*var\\(${token}\\)`));
  });

  it('defaults the gap to md', () => {
    render(<Stack>x</Stack>);
    const stack = document.querySelector('.ui-stack')!;
    expect(stack.classList.contains('ui-stack--md')).toBe(true);
    expect(stack.classList.contains('ui-stack--sm')).toBe(false);
    expect(stack.classList.contains('ui-stack--lg')).toBe(false);
  });

  it('defaults to no alignment class, leaving the grid at its own start', () => {
    render(<Stack>x</Stack>);
    const stack = document.querySelector('.ui-stack')!;
    expect(stack.classList.contains('ui-stack--center')).toBe(false);
    expect(stack.classList.contains('ui-stack--end')).toBe(false);
  });

  it.each<[StackAlign, string]>([
    ['center', 'center'],
    ['end', 'end'],
  ])('maps align="%s" to justify-items: %s', (align, justifyItems) => {
    render(<Stack align={align}>x</Stack>);
    const stack = document.querySelector('.ui-stack')!;
    expect(stack.classList.contains(`ui-stack--${align}`)).toBe(true);
    expect(cssBlock(`.ui-stack--${align}`)).toMatch(
      new RegExp(`justify-items:\\s*${justifyItems}`),
    );
  });

  it('uses display: grid and no outer margins on the base block', () => {
    expect(cssBlock('.ui-stack')).toMatch(/display:\s*grid/);
    expect(cssBlock('.ui-stack')).not.toMatch(/margin/);
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
    expect(classesOf(document.querySelector('.ui-stack')!)).toEqual([
      'legacy-hook',
      'ui-stack',
      'ui-stack--md',
    ]);
  });

  it('forwards a ref to the rendered div', () => {
    const ref = createRef<HTMLDivElement>();
    render(<Stack ref={ref}>x</Stack>);
    expect(ref.current).toBe(document.querySelector('.ui-stack'));
    expect(ref.current?.tagName).toBe('DIV');
  });
});
