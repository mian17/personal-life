import { render, screen } from '@testing-library/react';
import { ListItem } from '../src/components/list-item';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

function classesWithPrefix(classes: string[], prefix: string): string[] {
  return classes.filter((token) => token.startsWith(prefix));
}

/** The row body carries its layout as utilities; the hook rides along for locators. */
const ROW_UTILITY = 'flex';
const ROW_TINT_UTILITY = 'bg-panel';
const LINK_LAYOUT_UTILITY = 'self-stretch';
/** A todo row clamps its title to two lines; every other row ellipsizes one. */
const TITLE_CLAMP_UTILITY = 'line-clamp-2';
const ONE_LINE_TITLE_UTILITY = 'truncate';
const DENSE_TYPE_UTILITY = 'text-[length:var(--space-0-7)]';

describe('ListItem', () => {
  it('renders an <li> row with the ui-list-item hook', () => {
    render(
      <ul>
        <ListItem title="Groceries" />
      </ul>,
    );
    const li = screen.getByRole('listitem');
    expect(li.tagName).toBe('LI');
    expect(classesOf(li)).toContain('ui-list-item');
  });

  it('takes the row surface from utilities rather than a stylesheet rule', () => {
    render(
      <ul>
        <ListItem title="Groceries" />
      </ul>,
    );
    const classes = classesOf(screen.getByRole('listitem'));
    expect(classes).toContain(ROW_UTILITY);
    expect(classes).toContain(ROW_TINT_UTILITY);
  });

  it('renders href as a link carrying the ui-list-item__link hook', () => {
    render(
      <ul>
        <ListItem href="/notes/1" title="Groceries" />
      </ul>,
    );
    const link = screen.getByRole('link');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/notes/1');
    expect(classesOf(link)).toContain('ui-list-item__link');
  });

  it('stretches the row body to the full row height, so the whole row is the target', () => {
    render(
      <ul>
        <ListItem href="/notes/1" title="Groceries" />
      </ul>,
    );
    expect(classesOf(screen.getByRole('link'))).toContain(LINK_LAYOUT_UTILITY);
  });

  it('renders a span row body (never a link) when href is absent', () => {
    render(
      <ul>
        <ListItem title="Groceries" />
      </ul>,
    );
    expect(screen.queryByRole('link')).toBeNull();
    const body = document.querySelector('.ui-list-item__link')!;
    expect(body.tagName).toBe('SPAN');
  });

  it('reproduces the note-row structure: link -> text -> title + sub', () => {
    render(
      <ul>
        <ListItem
          href="/notes/1"
          title="Groceries"
          meta={<time dateTime="2026-09-27">Today</time>}
          snippet="milk and eggs"
        />
      </ul>,
    );
    const text = document.querySelector('.ui-list-item__text')!;
    expect(text.tagName).toBe('SPAN');
    expect(document.querySelector('.ui-list-item__title')!.textContent).toBe('Groceries');
    const sub = document.querySelector('.ui-list-item__sub')!;
    expect(sub.contains(screen.getByText('Today'))).toBe(true);
    expect(document.querySelector('.ui-list-item__sep')!.textContent).toBe('|');
    expect(document.querySelector('.ui-list-item__snippet')!.textContent).toBe('milk and eggs');
    expect(document.querySelector('.ui-list-item__link')!.contains(text)).toBe(true);
  });

  it('renders meta without a separator when snippet is absent', () => {
    render(
      <ul>
        <ListItem
          href="/notes/1"
          title="Groceries"
          meta={<time dateTime="2026-09-27">Today</time>}
        />
      </ul>,
    );
    expect(document.querySelector('.ui-list-item__sep')).toBeNull();
    expect(document.querySelector('.ui-list-item__snippet')).toBeNull();
    expect(document.querySelector('.ui-list-item__sub')!.contains(screen.getByText('Today'))).toBe(
      true,
    );
  });

  it('renders the trailing and deleteAction slots in order after the row body', () => {
    render(
      <ul>
        <ListItem
          href="/notes/1"
          title="Groceries"
          trailing={<span data-testid="trailing" />}
          deleteAction={
            <form data-testid="delete-action">
              <button type="submit">Delete</button>
            </form>
          }
        />
      </ul>,
    );
    const li = screen.getByRole('listitem');
    const children = Array.from(li.children);
    expect(children[0]).toBe(document.querySelector('.ui-list-item__link'));
    expect(children[1]).toBe(screen.getByTestId('trailing'));
    expect(children[2]).toBe(screen.getByTestId('delete-action'));
  });

  it('lays the trailing slot out as a flex row, so its form fills the slot', () => {
    render(
      <ul>
        <ListItem
          title="Groceries"
          deleteAction={
            <form data-testid="delete-action">
              <button type="submit">Delete</button>
            </form>
          }
        />
      </ul>,
    );
    const classes = classesOf(screen.getByRole('listitem'));
    expect(classes).toContain('[&>form]:flex');
    // The delete control keeps a compact inset rather than its default tap square.
    expect(classesWithPrefix(classes, '[&>form>.ui-btn--danger]:p-')).toHaveLength(1);
  });

  it('renders leading as the first child, before the row body', () => {
    render(
      <ul>
        <ListItem
          href="/notes/1"
          title="Groceries"
          leading={<button data-testid="leading">done</button>}
        />
      </ul>,
    );
    const li = screen.getByRole('listitem');
    const children = Array.from(li.children);
    expect(children[0]).toBe(screen.getByTestId('leading'));
    expect(children[1]).toBe(document.querySelector('.ui-list-item__link'));
  });

  it('adds the todo variant with a dense size and sizes dense type through tokens', () => {
    render(
      <ul>
        <ListItem variant="todo" size="dense" title="Groceries" />
      </ul>,
    );
    expect(classesOf(screen.getByRole('listitem'))).toEqual(
      expect.arrayContaining(['ui-list-item--dense', 'ui-list-item--todo']),
    );

    expect(classesOf(document.querySelector('.ui-list-item__title')!)).toContain(
      DENSE_TYPE_UTILITY,
    );
    expect(classesOf(document.querySelector('.ui-list-item__sub')!)).toContain(DENSE_TYPE_UTILITY);

    // A dense row is exactly its content height, at the compact control scale.
    const row = classesOf(screen.getByRole('listitem'));
    expect(row).toContain('min-h-0');
    expect(row).toContain('[--checkbox-size:var(--space-0-75)]');
  });

  it('clamps the todo title to two lines, and leaves a base row one line', () => {
    const { unmount } = render(
      <ul>
        <ListItem variant="todo" title="Groceries" />
      </ul>,
    );
    expect(classesOf(document.querySelector('.ui-list-item__title')!)).toContain(
      TITLE_CLAMP_UTILITY,
    );
    unmount();

    render(
      <ul>
        <ListItem title="Groceries" />
      </ul>,
    );
    const baseTitle = classesOf(document.querySelector('.ui-list-item__title')!);
    expect(baseTitle).not.toContain(TITLE_CLAMP_UTILITY);
    expect(baseTitle).toContain(ONE_LINE_TITLE_UTILITY);
  });

  it('adds the todo variant alone: the large checkbox, centred against the row', () => {
    render(
      <ul>
        <ListItem variant="todo" title="Groceries" />
      </ul>,
    );
    const classes = classesOf(screen.getByRole('listitem'));
    expect(classes).toContain('ui-list-item--todo');
    expect(classes).toContain('[--checkbox-size:var(--space-1-25)]');
    // The default todo row centres its leading control; the dense scale does too.
    expect(classes).toContain('items-center');
    expect(classes).not.toContain('ui-list-item--dense');
  });

  it('treats size="dense" without the todo variant as a no-op', () => {
    render(
      <ul>
        <ListItem size="dense" title="Groceries" />
      </ul>,
    );
    const classes = classesOf(screen.getByRole('listitem'));
    expect(classes).not.toContain('ui-list-item--dense');
    expect(classes).not.toContain(DENSE_TYPE_UTILITY);
    expect(classes).toContain('items-center');
  });

  it('centres the dense todo row on its leading control, and keeps a column row top-aligned', () => {
    const { unmount } = render(
      <ul>
        <ListItem variant="todo" size="dense" title="Groceries" />
      </ul>,
    );
    const denseRow = classesOf(screen.getByRole('listitem'));
    expect(denseRow).toContain('items-center');
    expect(denseRow).not.toContain('items-start');
    unmount();

    render(
      <ul>
        <ListItem variant="nested" title="Groceries" />
      </ul>,
    );
    expect(classesOf(screen.getByRole('listitem'))).toContain('items-start');
  });

  it('adds the nested variant: a column row whose body indents beneath the title', () => {
    render(
      <ul>
        <ListItem variant="nested" title="Omelette">
          <span data-testid="child" />
        </ListItem>
      </ul>,
    );
    expect(classesOf(screen.getByRole('listitem'))).toContain('ui-list-item--nested');

    // The title is the parent line; the child lives in the indented body below it.
    const body = document.querySelector('.ui-list-item__nested-body')!;
    expect(body.contains(screen.getByTestId('child'))).toBe(true);
    expect(body.previousElementSibling).toBe(document.querySelector('.ui-list-item__text'));

    const link = classesOf(document.querySelector('.ui-list-item__link')!);
    expect(link).toContain('flex-col');
    expect(link).toContain('items-stretch');

    // The indent rides a token, and the row top-aligns so the delete slot sits with
    // the parent line rather than centring against the tall body.
    expect(classesOf(body)).toContain('pl-[var(--space-1)]');
    const row = classesOf(screen.getByRole('listitem'));
    expect(row).toContain('items-start');
    expect(classesWithPrefix(row, '[&>.ui-icon-btn]:mt-')).toHaveLength(1);
    expect(classesWithPrefix(row, '[&>form]:mt-')).toHaveLength(1);
  });

  it('renders the nested titleAction inside the title line, and marks the line for it', () => {
    render(
      <ul>
        <ListItem
          variant="nested"
          title="Omelette"
          titleAction={<button data-testid="remove">Remove</button>}
        >
          <span data-testid="child" />
        </ListItem>
      </ul>,
    );

    const titleLine = document.querySelector('.ui-list-item__title')!;
    expect(classesOf(titleLine)).toContain('ui-list-item__title--with-action');

    const slot = document.querySelector('.ui-list-item__title-action')!;
    expect(slot.contains(screen.getByTestId('remove'))).toBe(true);
    // The action rides the title line, not the indented child body.
    expect(titleLine.contains(slot)).toBe(true);
    expect(document.querySelector('.ui-list-item__nested-body')!.contains(slot)).toBe(false);
    // ... and the title content stays the line's first child, so it grows.
    expect(titleLine.firstChild!.textContent).toBe('Omelette');

    const line = classesOf(titleLine);
    expect(line).toContain('flex');
    expect(line).toContain('items-stretch');
    expect(line).toContain('[&>:first-child]:flex-1');
    expect(line).toContain('[&>:first-child]:min-w-0');

    // The action stretches to the line and never sets its own height.
    const action = classesOf(slot);
    expect(action).toContain('items-center');
    expect(action.some((token) => /(^|:)h-|height/.test(token))).toBe(false);
  });

  it('leaves the nested title a plain block when no titleAction is given', () => {
    render(
      <ul>
        <ListItem variant="nested" title="Omelette">
          <span data-testid="child" />
        </ListItem>
      </ul>,
    );

    expect(classesOf(document.querySelector('.ui-list-item__title')!)).not.toContain(
      'ui-list-item__title--with-action',
    );
    expect(document.querySelector('.ui-list-item__title-action')).toBeNull();
  });

  it('adds the feedback variant: a column row whose title line carries the status pill', () => {
    render(
      <ul>
        <ListItem
          variant="feedback"
          title="Dark mode flickers"
          meta={<time dateTime="2026-10-16">Today</time>}
          snippet="On cold load"
          titleAction={<span data-testid="status-pill">Open</span>}
        >
          <span data-testid="status-dropdown" />
        </ListItem>
      </ul>,
    );

    expect(classesOf(screen.getByRole('listitem'))).toContain('ui-list-item--feedback');

    // The pill rides the title line; the dropdown is the row body below it.
    const titleLine = document.querySelector('.ui-list-item__title')!;
    expect(classesOf(titleLine)).toContain('ui-list-item__title--with-action');
    const pillSlot = document.querySelector('.ui-list-item__title-action')!;
    expect(pillSlot.contains(screen.getByTestId('status-pill'))).toBe(true);
    expect(titleLine.contains(pillSlot)).toBe(true);

    const link = document.querySelector('.ui-list-item__link')!;
    expect(link.contains(screen.getByTestId('status-dropdown'))).toBe(true);
    expect(link.contains(titleLine)).toBe(true);

    // Three lines: title, then the description line, then the meta line. The
    // base row would put both on one line separated by a `|`, so a feedback row
    // splits them into two `__sub` lines and drops the separator.
    const text = document.querySelector('.ui-list-item__text')!;
    const snippet = document.querySelector('.ui-list-item__snippet')!;
    const subLines = text.querySelectorAll('.ui-list-item__sub');
    expect(snippet.textContent).toBe('On cold load');
    expect(subLines).toHaveLength(2);
    expect(subLines[0].contains(snippet)).toBe(true);
    expect(subLines[1].textContent).toBe('Today');
    expect(text.firstElementChild).toBe(titleLine);
    expect(titleLine.nextElementSibling).toBe(subLines[0]);
    expect(subLines[0].nextElementSibling).toBe(subLines[1]);
    expect(document.querySelector('.ui-list-item__sep')).toBeNull();

    const linkClasses = classesOf(link);
    expect(linkClasses).toContain('flex-col');
    expect(linkClasses).toContain('items-stretch');

    const line = classesOf(titleLine);
    expect(line).toContain('flex');
    expect(line).toContain('items-stretch');
    expect(line).toContain('[&>:first-child]:flex-1');
    expect(line).toContain('[&>:first-child]:min-w-0');
  });

  it('leaves the feedback title a plain block when no pill is given', () => {
    render(
      <ul>
        <ListItem variant="feedback" title="Dark mode flickers" />
      </ul>,
    );

    expect(classesOf(document.querySelector('.ui-list-item__title')!)).not.toContain(
      'ui-list-item__title--with-action',
    );
    expect(document.querySelector('.ui-list-item__title-action')).toBeNull();
  });

  it('adds a tone class for a coloured lens row, and none without a tone', () => {
    const { unmount } = render(
      <ul>
        <ListItem tone="danger" title="Groceries" />
      </ul>,
    );
    expect(classesOf(screen.getByRole('listitem'))).toContain('ui-list-item--danger');
    unmount();

    render(
      <ul>
        <ListItem title="Groceries" />
      </ul>,
    );
    const classes = classesOf(screen.getByRole('listitem'));
    expect(classes).toContain('ui-list-item');
    expect(classes.some((token) => token.includes('text-danger'))).toBe(false);
  });

  it('merges className instead of replacing it', () => {
    render(
      <ul>
        <ListItem className="legacy-hook" title="Groceries" />
      </ul>,
    );
    const classes = classesOf(screen.getByRole('listitem'));
    expect(classes).toContain('legacy-hook');
    expect(classes).toContain('ui-list-item');
  });

  it('forwards arbitrary attributes', () => {
    render(
      <ul>
        <ListItem title="Groceries" data-extra="1" />
      </ul>,
    );
    expect(screen.getByRole('listitem').getAttribute('data-extra')).toBe('1');
  });

  it('adds the done class for a completed row', () => {
    render(
      <ul>
        <ListItem done title="Groceries" />
      </ul>,
    );
    expect(classesOf(screen.getByRole('listitem'))).toContain('ui-list-item--done');
  });

  it('adds the collapsing class while hiding', () => {
    render(
      <ul>
        <ListItem collapsing title="Groceries" />
      </ul>,
    );
    expect(classesOf(screen.getByRole('listitem'))).toContain('ui-list-item--collapsing');
  });

  it('strikes and mutes the done title through tokens', () => {
    render(
      <ul>
        <ListItem done title="Groceries" />
      </ul>,
    );
    const classes = classesOf(document.querySelector('.ui-list-item__title')!);
    expect(classes).toContain('text-muted');
    expect(classes).toContain('line-through');
  });

  it('mutes a completed row uniformly: the tone tint yields to --done', () => {
    render(
      <ul>
        <ListItem tone="danger" done title="Groceries" />
      </ul>,
    );
    const row = classesOf(screen.getByRole('listitem'));
    // The tone hook stays for locators, but no tone colour is applied to a done row.
    expect(row).toContain('ui-list-item--danger');
    expect(row).not.toContain('[&_.ui-icon-btn]:text-danger');
    expect(row).toContain('[&_.ui-icon-btn]:text-muted');
    expect(row).toContain('[&_.ui-due-date]:text-muted');
  });

  it('applies one done treatment at both todo sizes', () => {
    const { unmount } = render(
      <ul>
        <ListItem variant="todo" done title="Groceries" />
      </ul>,
    );
    expect(classesOf(document.querySelector('.ui-list-item__title')!)).toContain('line-through');
    unmount();

    render(
      <ul>
        <ListItem variant="todo" size="dense" done title="Groceries" />
      </ul>,
    );
    const classes = classesOf(screen.getByRole('listitem'));
    expect(classes).toContain('ui-list-item--done');
    expect(classes).toContain('ui-list-item--dense');
    // The done rules key off `--done`, never a size, so the due date is muted at both.
    expect(classes).toContain('[&_.ui-due-date]:text-muted');
  });

  it('collapses the row to zero height while hiding', () => {
    render(
      <ul>
        <ListItem collapsing title="Groceries" />
      </ul>,
    );
    const classes = classesOf(screen.getByRole('listitem'));
    expect(classes).toContain('h-0');
    expect(classes).toContain('min-h-0');
    expect(classes).toContain('overflow-hidden');
  });

  it('transitions the base row through the motion tokens', () => {
    render(
      <ul>
        <ListItem title="Groceries" />
      </ul>,
    );
    const classes = classesOf(screen.getByRole('listitem'));
    expect(classes).toContain('transition-[height,opacity]');
    expect(classes).toContain('duration-[var(--duration-base)]');
    expect(classes).toContain('ease-[var(--ease-standard)]');
  });
});
