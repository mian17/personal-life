import { render } from '@testing-library/react';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Row } from '../src/components/row';

/**
 * `Row` — horizontal companion to `Stack`. Assertions mirror
 * `stack.test.tsx`: the class contract plus the resolved CSS rule from
 * `blocks.css` (jsdom does not apply the stylesheet, so the rule text is the
 * source of truth for the token mapping).
 */

const blocksCss = readFileSync(
  join(__dirname, '..', 'src', 'styles', 'blocks.css'),
  'utf8',
);

function ruleFor(selector: string): string {
  const match = blocksCss.match(
    new RegExp(`${selector.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*\\{([^}]*)\\}`),
  );
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1];
}

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

  it('maps each gap to its modifier class', () => {
    for (const gap of ['sm', 'md', 'lg'] as const) {
      const { container } = render(createElement(Row, { gap }));
      expect((container.firstElementChild as HTMLElement).className).toContain(`ui-row--${gap}`);
    }
  });

  it('the CSS is a flex row that wraps, with the token gap and no outer margin', () => {
    expect(ruleFor('.ui-row')).toContain('display: flex');
    expect(ruleFor('.ui-row')).toContain('flex-wrap: wrap');
    expect(ruleFor('.ui-row')).not.toContain('margin');
    expect(ruleFor('.ui-row--sm')).toContain('gap: var(--space-0-5)');
    expect(ruleFor('.ui-row--md')).toContain('gap: var(--space-1)');
    expect(ruleFor('.ui-row--lg')).toContain('gap: var(--space-2)');
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
