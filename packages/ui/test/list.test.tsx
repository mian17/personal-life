import { render, screen } from '@testing-library/react';
import { List } from '../src/components/list';

const GROUP_SURFACE_UTILITY = 'bg-surface';
const GROUP_LINE_UTILITY = 'border-line';
const GROUP_RADIUS_UTILITY = 'rounded-[var(--r-lg)]';
const ROW_DIVIDER_UTILITY = 'divide-line';
const LIST_RESET_UTILITY = 'list-none';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('List', () => {
  it('renders a <ul> list landmark with the ui-list hook', () => {
    render(
      <List>
        <li>row</li>
      </List>,
    );
    const ul = screen.getByRole('list');
    expect(ul.tagName).toBe('UL');
    expect(classesOf(ul)).toContain('ui-list');
  });

  it('paints the group surface from token utilities rather than a stylesheet rule', () => {
    render(
      <List>
        <li>row</li>
      </List>,
    );
    const classes = classesOf(screen.getByRole('list'));
    // §8's `.group`: one surface, one hairline frame, one dividers rule between rows.
    expect(classes).toContain(GROUP_SURFACE_UTILITY);
    expect(classes).toContain('border');
    expect(classes).toContain(GROUP_LINE_UTILITY);
    expect(classes).toContain(GROUP_RADIUS_UTILITY);
    expect(classes).toContain('divide-y');
    expect(classes).toContain(ROW_DIVIDER_UTILITY);
    expect(classes).toContain('overflow-hidden');
    // Rows carry their own insets, so the group adds no gap between them.
    expect(classes.some((c) => c.startsWith('gap-'))).toBe(false);
    // The browser's own bullet, indent and margin are cleared on the element itself:
    // `base.css` resets the document box only.
    expect(classes).toContain(LIST_RESET_UTILITY);
  });

  it('renders its list items inside the ul', () => {
    render(
      <List>
        <li>one</li>
        <li>two</li>
      </List>,
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(screen.getByRole('list').contains(items[0])).toBe(true);
  });

  it('merges className instead of replacing it', () => {
    render(
      <List className="legacy-hook">
        <li>row</li>
      </List>,
    );
    const classes = classesOf(screen.getByRole('list'));
    expect(classes).toContain('legacy-hook');
    expect(classes).toContain('ui-list');
  });

  it('forwards arbitrary attributes', () => {
    render(
      <List data-extra="1" aria-label="notes">
        <li>row</li>
      </List>,
    );
    const ul = screen.getByRole('list');
    expect(ul.getAttribute('data-extra')).toBe('1');
    expect(ul.getAttribute('aria-label')).toBe('notes');
  });
});
