import { render, screen } from '@testing-library/react';
import { ListShell } from '../src/components/list-shell';

function order(root: Element): string[] {
  return Array.from(root.children).map((child) =>
    child.getAttribute('data-testid') ?? child.tagName.toLowerCase(),
  );
}

describe('ListShell', () => {
  it('renders the fixed slot order: nav → title → tabs → search → filters → body → fab', () => {
    render(
      <ListShell
        title="Notes"
        navTrailing={<span data-testid="nav-trailing" />}
        tabs={<span data-testid="tabs" />}
        search={<span data-testid="search" />}
        filters={<span data-testid="filters" />}
        body={<span data-testid="body" />}
        fabHref="/notes/new"
        fabLabel="New note"
        fabIcon={<span data-testid="fab-icon" />}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Notes' })).toBeTruthy();
    expect(order(document.querySelector('.ui-page')!)).toEqual([
      'nav',
      'h1',
      'tabs',
      'search',
      'filters',
      'body',
      'a',
    ]);
  });

  it('renders nothing for omitted optional slots (no empty wrapper)', () => {
    const { container } = render(
      <ListShell
        title="Notes"
        body={<span data-testid="body" />}
        fabHref="/notes/new"
        fabLabel="New note"
        fabIcon={<span data-testid="fab-icon" />}
      />,
    );

    expect(screen.queryByTestId('nav-trailing')).toBeNull();
    expect(screen.queryByTestId('tabs')).toBeNull();
    expect(screen.queryByTestId('search')).toBeNull();
    expect(screen.queryByTestId('filters')).toBeNull();
    expect(container.querySelector('.ui-nav-bar__actions')).toBeNull();
    expect(order(container.querySelector('.ui-page')!)).toEqual([
      'nav',
      'h1',
      'body',
      'a',
    ]);
  });

  it('renders the title as the page h1', () => {
    render(
      <ListShell
        title="Todos"
        body={<span />}
        fabHref="/todos/new"
        fabLabel="New todo"
        fabIcon={<span />}
      />,
    );
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.tagName).toBe('H1');
    expect(heading.textContent).toBe('Todos');
  });

  it('passes fabLabel/fabHref to the FabLink aria-label and href', () => {
    render(
      <ListShell
        title="Notes"
        body={<span />}
        fabHref="/notes/new"
        fabLabel="New note"
        fabIcon={<span data-testid="fab-icon" />}
      />,
    );
    const link = screen.getByRole('link', { name: 'New note' });
    expect(link.getAttribute('href')).toBe('/notes/new');
    expect(link.getAttribute('aria-label')).toBe('New note');
    expect(link.contains(screen.getByTestId('fab-icon'))).toBe(true);
  });

  it('renders body verbatim, untouched', () => {
    render(
      <ListShell
        title="Notes"
        body={<p data-testid="body">nothing here yet</p>}
        fabHref="/notes/new"
        fabLabel="New note"
        fabIcon={<span />}
      />,
    );
    expect(screen.getByTestId('body').textContent).toBe('nothing here yet');
  });
});
