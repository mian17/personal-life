import { render } from '@testing-library/react';
import { createElement } from 'react';
import { Row } from '../src/components/row';

/**
 * `Row` — the horizontal companion to `Stack`. Assertions mirror
 * `stack.test.tsx`: the class contract plus the token gap utility each gap
 * resolves to.
 */

const GAP_UTILITY = {
  sm: 'gap-[var(--s1)]',
  md: 'gap-[var(--s2)]',
  lg: 'gap-[var(--s4)]',
} as const;

describe('Row', () => {
  it('renders children in a div with the default md gap class', () => {
    const { container } = render(
      createElement(Row, null, createElement('span', null, 'a'), createElement('span', null, 'b')),
    );
    const div = container.firstElementChild as HTMLElement;
    expect(div.tagName).toBe('DIV');
    expect(div.className).toContain('ui-row');
    expect(div.className).toContain('ui-row--md');
    expect(div.querySelectorAll('span')).toHaveLength(2);
  });

  it('maps each gap to its modifier class and token utility', () => {
    for (const gap of ['sm', 'md', 'lg'] as const) {
      const { container } = render(createElement(Row, { gap }));
      const div = container.firstElementChild as HTMLElement;
      expect(div.className).toContain(`ui-row--${gap}`);
      expect(div.className).toContain(GAP_UTILITY[gap]);
    }
  });

  it('is a wrapping flex row with no outer margin', () => {
    const { container } = render(createElement(Row, null));
    const classes = (container.firstElementChild as HTMLElement).className.split(/\s+/);
    expect(classes).toContain('flex');
    expect(classes).toContain('flex-wrap');
    expect(classes.some((name) => name.startsWith('m-'))).toBe(false);
  });

  it('merges className and forwards arbitrary attributes', () => {
    const { container } = render(
      createElement(Row, { className: 'extra', 'data-testid': 'row' } as never),
    );
    const div = container.firstElementChild as HTMLElement;
    expect(div.className).toContain('ui-row');
    expect(div.className).toContain('extra');
    expect(div.getAttribute('data-testid')).toBe('row');
  });
});
