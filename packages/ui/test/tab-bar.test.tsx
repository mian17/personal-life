import { render, screen } from '@testing-library/react';
import { Tab, TabBar } from '../src/components/tab-bar';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('Tab', () => {
  it('renders a next/link anchor with the href and children verbatim', () => {
    render(<Tab href="/todos">List</Tab>);
    const link = screen.getByRole('link', { name: 'List' });
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/todos');
    expect(link.getAttribute('data-next-link')).toBe('');
    expect(classesOf(link)).toEqual(['ui-tab']);
  });

  it('marks the active tab with aria-current="page"', () => {
    render(<Tab href="/todos" active>List</Tab>);
    const link = screen.getByRole('link', { name: 'List' });
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(classesOf(link)).toEqual(['ui-tab', 'ui-tab--active']);
  });

  it('omits aria-current when not active', () => {
    render(<Tab href="/todos/matrix">Matrix</Tab>);
    const link = screen.getByRole('link', { name: 'Matrix' });
    expect(link.hasAttribute('aria-current')).toBe(false);
    expect(link.classList.contains('ui-tab--active')).toBe(false);
  });

  it('merges className instead of replacing it', () => {
    render(<Tab href="/todos" className="legacy-hook">List</Tab>);
    expect(classesOf(screen.getByRole('link', { name: 'List' }))).toEqual([
      'legacy-hook',
      'ui-tab',
    ]);
  });
});

describe('TabBar', () => {
  it('renders a <nav> landmark with the aria-label and the tabs in order', () => {
    render(
      <TabBar aria-label="Todos views">
        <Tab href="/todos" active>List</Tab>
        <Tab href="/todos/matrix">Matrix</Tab>
      </TabBar>,
    );
    const nav = screen.getByRole('navigation', { name: 'Todos views' });
    expect(nav.tagName).toBe('NAV');
    expect(classesOf(nav)).toEqual(['ui-tab-bar']);
    expect(Array.from(nav.children).map((child) => child.textContent)).toEqual([
      'List',
      'Matrix',
    ]);
  });

  it('merges className instead of replacing it', () => {
    render(
      <TabBar aria-label="Todos views" className="legacy-hook">
        <Tab href="/todos">List</Tab>
      </TabBar>,
    );
    expect(classesOf(screen.getByRole('navigation'))).toEqual([
      'legacy-hook',
      'ui-tab-bar',
    ]);
  });
});
