import { render, screen } from '@testing-library/react';
import { List } from '../src/components/list';

const STACKING_UTILITY = 'grid';
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

  it('takes its stacking from utilities rather than a stylesheet rule', () => {
    render(
      <List>
        <li>row</li>
      </List>,
    );
    const classes = classesOf(screen.getByRole('list'));
    expect(classes).toContain(STACKING_UTILITY);
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
