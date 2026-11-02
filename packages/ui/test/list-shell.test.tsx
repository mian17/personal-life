import { render, screen } from '@testing-library/react';
import { ListShell } from '../src/components/list-shell';

const FILL_PAGE_UTILITIES = ['flex', 'flex-col', 'h-[100dvh]', 'overflow-hidden'];
const FILL_BODY_UTILITIES = ['flex-1', 'min-h-0', 'grid', '[grid-template-rows:minmax(0,1fr)]'];

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

  it('renders no FabLink when the fab props are omitted', () => {
    const { container } = render(<ListShell title="Feedback" body={<span data-testid="body" />} />);

    expect(screen.queryByRole('link')).toBeNull();
    expect(container.querySelector('.ui-fab-link')).toBeNull();
    expect(order(container.querySelector('.ui-page')!)).toEqual(['nav', 'h1', 'body']);
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

  it('drops the fab clearance when no fab renders, so the page reaches the safe area', () => {
    const { container } = render(<ListShell title="Pomodoro" body={<span />} fill />);

    const page = container.querySelector('.ui-page')!;
    expect(page.classList.contains('pb-[calc(var(--s6)+env(safe-area-inset-bottom))]!')).toBe(
      true,
    );
  });

  it('keeps the fab clearance while a fab renders', () => {
    const { container } = render(
      <ListShell
        title="Matrix"
        body={<span />}
        fabHref="/todos/new"
        fabLabel="New todo"
        fabIcon={<span />}
        fill
      />,
    );

    const page = container.querySelector('.ui-page')!;
    expect(
      page.classList.contains(
        'pb-[calc(var(--fab-size)+var(--s8)+env(safe-area-inset-bottom))]',
      ),
    ).toBe(true);
    expect(page.classList.contains('pb-[calc(var(--s6)+env(safe-area-inset-bottom))]!')).toBe(
      false,
    );
  });

  it('the fill utilities make the page a full-height column and the body grow', () => {
    const { container } = render(
      <ListShell
        title="Matrix"
        body={<span data-testid="body" />}
        fabHref="/todos/new"
        fabLabel="New todo"
        fabIcon={<span />}
        fill
      />,
    );

    const page = container.querySelector('.ui-page')!;
    for (const utility of FILL_PAGE_UTILITIES) {
      expect(page.classList.contains(utility)).toBe(true);
    }

    const body = container.querySelector('.ui-list-shell__body')!;
    for (const utility of FILL_BODY_UTILITIES) {
      expect(body.classList.contains(utility)).toBe(true);
    }

    // Guard: the fill geometry resolves through keywords/tokens, never a raw px/hex/rgb value.
    const classes = `${page.className} ${body.className}`;
    expect(classes).not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(|\b\d+(?:\.\d+)?px\b/);
  });
});
