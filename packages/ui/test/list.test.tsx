import { render, screen } from '@testing-library/react';
import { List } from '../src/components/list';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('List', () => {
  it('renders a <ul> list landmark with the ui-list class', () => {
    render(
      <List>
        <li>row</li>
      </List>,
    );
    const ul = screen.getByRole('list');
    expect(ul.tagName).toBe('UL');
    expect(classesOf(ul)).toEqual(['ui-list']);
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
    expect(classesOf(screen.getByRole('list'))).toEqual(['legacy-hook', 'ui-list']);
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
