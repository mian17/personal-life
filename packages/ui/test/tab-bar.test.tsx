import { render, screen } from '@testing-library/react';
import { Tab, TabBar } from '../src/components/tab-bar';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('Tab', () => {
  it('renders a route anchor inside the Radix trigger', () => {
    render(
      <TabBar aria-label="Todos views">
        <Tab href="/todos">List</Tab>
      </TabBar>,
    );
    const tab = screen.getByRole('tab', { name: 'List' });
    expect(tab.tagName).toBe('A');
    expect(tab.getAttribute('href')).toBe('/todos');
    expect(tab.getAttribute('data-next-link')).toBe('');
    expect(tab.getAttribute('data-slot')).toBe('tabs-trigger');
    expect(tab.classList.contains('ui-tab')).toBe(true);
  });

  it('selects the active tab and carries the compat hook', () => {
    render(
      <TabBar aria-label="Todos views">
        <Tab href="/todos" active>List</Tab>
      </TabBar>,
    );
    const tab = screen.getByRole('tab', { name: 'List' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(tab.classList.contains('ui-tab--active')).toBe(true);
  });

  it('paints the active tab from the prop, not from the forwarded Radix state', () => {
    render(
      <TabBar aria-label="Todos views">
        <Tab href="/todos" active>List</Tab>
        <Tab href="/todos/matrix">Matrix</Tab>
      </TabBar>,
    );
    // The surface rides the prop-conditioned classes the anchor receives itself.
    const active = classesOf(screen.getByRole('tab', { name: 'List' }));
    expect(active).toContain('bg-max');
    expect(active).toContain('text-on-max');

    const inactive = classesOf(screen.getByRole('tab', { name: 'Matrix' }));
    expect(inactive).not.toContain('bg-max');
    expect(inactive).not.toContain('text-on-max');

    // `asChild` does forward `data-state`, so the `data-[state=active]` fallback is live.
    expect(screen.getByRole('tab', { name: 'List' }).getAttribute('data-state')).toBe('active');
  });

  it('leaves the other tabs unselected', () => {
    render(
      <TabBar aria-label="Todos views">
        <Tab href="/todos">List</Tab>
        <Tab href="/todos/matrix">Matrix</Tab>
      </TabBar>,
    );
    const matrix = screen.getByRole('tab', { name: 'Matrix' });
    expect(matrix.getAttribute('aria-selected')).toBe('false');
    expect(matrix.classList.contains('ui-tab--active')).toBe(false);
  });

  it('merges className instead of replacing it', () => {
    render(
      <TabBar aria-label="Todos views">
        <Tab href="/todos" className="legacy-hook">List</Tab>
      </TabBar>,
    );
    const classes = classesOf(screen.getByRole('tab', { name: 'List' }));
    expect(classes).toContain('legacy-hook');
    expect(classes).toContain('ui-tab');
  });
});

describe('TabBar', () => {
  it('renders a tab list named by the aria-label, tabs in order', () => {
    render(
      <TabBar aria-label="Todos views">
        <Tab href="/todos" active>List</Tab>
        <Tab href="/todos/matrix">Matrix</Tab>
      </TabBar>,
    );
    const list = screen.getByRole('tablist', { name: 'Todos views' });
    expect(list.getAttribute('data-slot')).toBe('tabs-list');
    expect(list.classList.contains('ui-tab-bar')).toBe(true);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
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
    const classes = classesOf(screen.getByRole('tablist'));
    expect(classes).toContain('legacy-hook');
    expect(classes).toContain('ui-tab-bar');
  });
});
