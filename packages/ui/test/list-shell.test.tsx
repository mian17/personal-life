import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { ListShell } from '../src/components/list-shell';

const css = readFileSync(join(__dirname, '..', 'src', 'styles', 'blocks.css'), 'utf8');

function cssBlock(selector: string): string {
  return (
    (css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)) ??
      [])[1] ?? ''
  );
}

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

  it('without fill adds no body wrapper and no fill class', () => {
    const { container } = render(
      <ListShell
        title="Notes"
        body={<span data-testid="body" />}
        fabHref="/notes/new"
        fabLabel="New note"
        fabIcon={<span />}
      />,
    );

    expect(container.querySelector('.ui-list-shell__body')).toBeNull();
    const page = container.querySelector('.ui-page')!;
    expect(page.classList.contains('ui-list-shell--fill')).toBe(false);
  });

  it('with fill marks the page and wraps the body in a growing slot', () => {
    const { container } = render(
      <ListShell
        title="Notes"
        body={<p data-testid="body">nothing here yet</p>}
        fabHref="/notes/new"
        fabLabel="New note"
        fabIcon={<span />}
        fill
      />,
    );

    const page = container.querySelector('.ui-page')!;
    expect(page.classList.contains('ui-list-shell--fill')).toBe(true);

    const wrapper = container.querySelector('.ui-list-shell__body')!;
    expect(wrapper).not.toBeNull();
    expect(wrapper.querySelector('[data-testid="body"]')!.textContent).toBe('nothing here yet');
  });

  it('the fill CSS makes the page a full-height column and the body grow (tokens only)', () => {
    const page = cssBlock('.ui-page.ui-list-shell--fill');
    expect(page).toMatch(/display:\s*flex/);
    expect(page).toMatch(/flex-direction:\s*column/);
    // Definite height, not min-height: a definite `100dvh` bounds the matrix quadrants.
    expect(page).toMatch(/(?<!min-)height:\s*100dvh/);
    expect(page).toMatch(/overflow:\s*hidden/);

    const body = cssBlock('.ui-list-shell__body');
    expect(body).toMatch(/flex:\s*1/);
    expect(body).toMatch(/min-height:\s*0/);

    // Guard: the fill declarations resolve through tokens/allowed keywords, never raw px/hex/rgb.
    const declarations = `${page}${body}`;
    expect(declarations).not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(/);
    expect(declarations).not.toMatch(/\b\d+(?:\.\d+)?px\b/);
  });
});
