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
const ROW_PRESS_UTILITY = 'active:bg-press';
const ROW_INSET_UTILITY = 'px-[var(--s4)]';
const LINK_LAYOUT_UTILITY = 'self-stretch';
/** A todo row clamps its title to two lines; every other row ellipsizes one. */
const TITLE_CLAMP_UTILITY = 'line-clamp-2';
const ONE_LINE_TITLE_UTILITY = 'truncate';
const DENSE_TYPE_UTILITY = 'text-[length:var(--fs-meta)]';

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

  it('takes its geometry from utilities and leaves the surface to its group', () => {
    render(
      <ul>
        <ListItem title="Groceries" />
      </ul>,
    );
    const classes = classesOf(screen.getByRole('listitem'));
    expect(classes).toContain(ROW_UTILITY);
    expect(classes).toContain(ROW_INSET_UTILITY);
    // §8's `.group`/`.row` split: the group paints the surface, so a row only carries its
    // own press wash — a per-row panel fill would double the surface the group already has.
    expect(classes).toContain(ROW_PRESS_UTILITY);
    expect(classes).not.toContain('bg-surface');
    expect(classes.some((cls) => cls.startsWith('rounded-'))).toBe(false);
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

  it('insets the row box, not each slot, so the delete glyph lands on the text edge', () => {
    render(
      <ul>
        <ListItem href="/meals/1" title="Oats" deleteAction={<button>x</button>} />
      </ul>,
    );
    const rowClasses = classesOf(document.querySelector('.ui-list-item')!);
    // §8 gives the inset to the row, so neither the body nor the trailing glyph needs a
    // compensating inset or a negative margin to line up with the text opposite it.
    expect(rowClasses).toContain(ROW_INSET_UTILITY);
    expect(rowClasses).toContain('[&>form>.ui-btn--danger]:p-[var(--s2)]');
    expect(rowClasses.some((cls) => cls.includes('mr-[calc('))).toBe(false);
    const linkClasses = classesOf(document.querySelector('.ui-list-item__link')!);
    expect(linkClasses.some((cls) => cls.startsWith('p-') || cls.startsWith('px-'))).toBe(false);
  });

  it('takes one row inset for both edges instead of per-side adjustments', () => {
    render(
      <ul>
        <ListItem
          variant="todo"
          title="Oats"
          leading={<input type="checkbox" aria-label="done" className="ui-checkbox" />}
          deleteAction={<button>x</button>}
        />
      </ul>,
    );
    const rowClasses = classesOf(screen.getByRole('listitem'));
    // `px-…` is one declaration for both edges, so the leading and trailing sides cannot
    // drift apart the way two independent insets could.
    expect(rowClasses).toContain('px-[var(--s4)]');
    expect(rowClasses.some((cls) => cls.startsWith('ps-') || cls.startsWith('pe-'))).toBe(false);
  });

  it('drops the fixed icon-square slot: the checkbox shrinks, the box inset does not move', () => {
    const { unmount } = render(
      <ul>
        <ListItem
          variant="todo"
          title="Oats"
          leading={<input type="checkbox" aria-label="done" className="ui-checkbox" />}
        />
      </ul>,
    );
    const rowClasses = classesOf(screen.getByRole('listitem'));
    // The old 40px `IconButton` wrapper parked the checkbox inside its square. The row now
    // keeps its own inset for leading slots, and the checkbox's mark is internally offset so
    // the glyph — not the control box — lands on that inset.
    expect(rowClasses).toContain('px-[var(--s4)]');
    expect(rowClasses.some((cls) => cls.includes('mx-[calc('))).toBe(false);
    unmount();

    render(
      <ul>
        <ListItem
          variant="todo"
          size="dense"
          title="Oats"
          leading={<input type="checkbox" aria-label="done" className="ui-checkbox" />}
        />
      </ul>,
    );
    // A dense row keeps the same rule at the tighter dense inset: `--s3` at the start, one
    // step tighter at the end, because a matrix row carries no trailing control.
    const denseClasses = classesOf(screen.getByRole('listitem'));
    expect(denseClasses).toContain('ps-[var(--s3)]');
    expect(denseClasses).toContain('pe-[var(--s2)]');
    expect(denseClasses.some((cls) => cls.includes('mx-[calc('))).toBe(false);
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

    // A dense row is exactly the tap target tall, at the compact control scale: the matrix
    // mark is `--s3` (12px), the value the pre-redesign row gave this variant (`0.75rem`),
    // and its slots top-align so the mark rides the title's first line.
    const row = classesOf(screen.getByRole('listitem'));
    expect(row).toContain('min-h-[var(--tap)]');
    expect(row).toContain('items-start');
    expect(row).not.toContain('items-center');
    expect(row).toContain('[--checkbox-size:var(--s3)]');
    // The corner travels with the size it is a fraction of: `--s1` (4px) is a third of this
    // 12px mark, the same third `--r-sm` (8px) is of the default 24px one. Left at `--r-sm`,
    // the 8px corner clamps to half the box and the mark paints as a disc instead of a box.
    expect(row).toContain('[--checkbox-radius:var(--s1)]');
  });

  it('takes the dense row checkbox target out of flow so it reserves no row width', () => {
    render(
      <ul>
        <ListItem variant="todo" size="dense" title="Groceries" />
      </ul>,
    );
    const row = classesOf(screen.getByRole('listitem'));
    const link = classesOf(document.querySelector('.ui-list-item__link')!);
    // The control's target is a 48px square. In flow it reserved 48px of row width and pushed
    // the title 60px off the row edge; the row is the target's positioning context instead, so
    // the target paints over the row and only the row's own insets place the title.
    expect(row).toContain('relative');
    expect(row).toContain('[&>.ui-checkbox]:absolute');
    // The 48px target keeps the row's top corner: moving it up to reach the first line would
    // push 6.89px of the painted square outside the row's `overflow-hidden` clip.
    expect(row).toContain('[&>.ui-checkbox]:top-[var(--s2)]');
    // The mark alone is lifted onto the title's first-line centre — the target's half-height
    // (`--tap`/2 = 24px) less the row's top inset (`--s2`) less half a title line
    // (`--fs-meta` at `--lh-row-title` = 9.11px) = 6.89px. A row whose mark rides the target's
    // own centring paints that 6.89px low, and low by the same amount on a two-line title.
    expect(row).toContain(
      '[&>.ui-checkbox>*]:-translate-y-[calc(var(--tap)/2-var(--s2)-var(--fs-meta)*var(--lh-row-title)/2)]',
    );
    // The mark rides the target's leading edge, so it lands on the row's start inset.
    expect(row).toContain('[&>.ui-checkbox]:justify-items-start');
    // The link clears the mark: `--s3` row inset + `--s4` = a 28px title offset, 16px from the
    // mark's trailing edge (the old row's 26.4px / 14.4px, at token granularity). The inset sits on
    // the link's own class list — a `[&>.ui-list-item__link]` utility compiles to a selector
    // Tailwind mangles at the `__` and never applies.
    expect(link).toContain('ps-[var(--s4)]');
    expect(row).not.toContain('[&>.ui-list-item__link]');
    // The target no longer contributes height, so the row keeps the tap floor itself.
    expect(row).toContain('min-h-[var(--tap)]');
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

  it('adds the todo variant alone: the default checkbox mark, centred against the row', () => {
    render(
      <ul>
        <ListItem variant="todo" title="Groceries" />
      </ul>,
    );
    const classes = classesOf(screen.getByRole('listitem'));
    expect(classes).toContain('ui-list-item--todo');
    // §8 gives the todo mark no size override, so the row leaves the control's own default
    // alone; only the dense row narrows it.
    expect(classes.some((cls) => cls.startsWith('[--checkbox-size:'))).toBe(false);
    // The corner is a hook of the mark's own size, so a row that does not narrow the mark must
    // not restate it either — the control's `.ui-checkbox__box` `--r-sm` stands.
    expect(classes.some((cls) => cls.startsWith('[--checkbox-radius:'))).toBe(false);
    // The default todo row centres its leading control; a dense row top-aligns it on the title's
    // first line, and a `size="dense"` without the todo variant never reaches that branch.
    expect(classes).toContain('items-center');
    expect(classes).not.toContain('ui-list-item--dense');
    // The default row keeps its control in flow: it has width to spare and the mark's own
    // 48px target is what places it, so the out-of-flow dense treatment must not leak here.
    expect(classes).not.toContain('[&>.ui-checkbox]:absolute');
    // Nor may the dense first-line lift: at this scale the control's own centring against the
    // row is the intended geometry, and a shifted mark would sit 11.43px off it.
    expect(classes.some((cls) => cls.startsWith('[&>.ui-checkbox>*]:-translate-y-'))).toBe(false);
    expect(classes.some((cls) => cls.startsWith('[&>.ui-checkbox]:top-'))).toBe(false);
    expect(classes.some((cls) => cls.startsWith('[&>.ui-list-item__link]:ps-'))).toBe(false);
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

  it('top-aligns the dense todo row on its first line, and keeps a column row top-aligned', () => {
    const { unmount } = render(
      <ul>
        <ListItem variant="todo" size="dense" title="Groceries" />
      </ul>,
    );
    const denseRow = classesOf(screen.getByRole('listitem'));
    expect(denseRow).toContain('items-start');
    expect(denseRow).not.toContain('items-center');
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

    // No extra indent: the nested body starts on the title's own column, so a child
    // field and the title field share a left edge.
    const bodyClasses = classesOf(body);
    expect(bodyClasses).not.toContain('pl-[var(--s2)]');
    expect(bodyClasses.some((token) => token.startsWith('pl-'))).toBe(false);
    // Without a title-line action there is no action column to reserve.
    expect(bodyClasses.some((token) => token.startsWith('pr-'))).toBe(false);
    const row = classesOf(screen.getByRole('listitem'));
    expect(row).toContain('items-start');
    // The title line and the child body both start at the row's own top inset, so no slot
    // needs a top offset to align with the title.
    expect(classesWithPrefix(row, '[&>.ui-icon-btn]:mt-')).toHaveLength(0);
    expect(classesWithPrefix(row, '[&>form]:mt-')).toHaveLength(0);
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
    // The nested body reserves the action's column (a full tap target plus the action-line
    // gap), so its right edge matches the title field's rather than the row's.
    expect(classesOf(document.querySelector('.ui-list-item__nested-body')!)).toContain(
      'pr-[calc(var(--tap)+var(--s2))]',
    );
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
    expect(classes).toContain('text-ink-2');
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
    expect(row).toContain('[&_.ui-icon-btn]:text-ink-3');
    expect(row).toContain('[&_.ui-due-date]:text-ink-3');
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
    // The done rules key off the done flag, never a size, so the due date is muted at both.
    expect(classes).toContain('[&_.ui-due-date]:text-ink-3');
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

  it('transitions the base row on the collapse properties and names no duration itself', () => {
    render(
      <ul>
        <ListItem title="Groceries" />
      </ul>,
    );
    const classes = classesOf(screen.getByRole('listitem'));
    expect(classes).toContain('motion-safe:transition-[height,opacity]');
    expect(classes).not.toContain('duration-[var(--d-base)]');
  });

  it('linkStylesFor: pins the link body class string for row, dense and column shapes', () => {
    const baseRow = render(
      <ul>
        <ListItem href="/notes/1" title="Groceries" />
      </ul>,
    );
    expect(document.querySelector('.ui-list-item__link')!.className).toBe(
      'ui-list-item__link flex flex-1 min-w-0 self-stretch text-inherit no-underline [-webkit-tap-highlight-color:transparent] items-center gap-[var(--s2)]',
    );
    baseRow.unmount();

    const denseRow = render(
      <ul>
        <ListItem variant="todo" size="dense" title="Groceries" />
      </ul>,
    );
    expect(document.querySelector('.ui-list-item__link')!.className).toBe(
      'ui-list-item__link flex flex-1 min-w-0 self-stretch text-inherit no-underline [-webkit-tap-highlight-color:transparent] items-center gap-[var(--s2)] ps-[var(--s4)]',
    );
    denseRow.unmount();

    render(
      <ul>
        <ListItem variant="nested" title="Omelette">
          <span />
        </ListItem>
      </ul>,
    );
    expect(document.querySelector('.ui-list-item__link')!.className).toBe(
      'ui-list-item__link flex flex-1 min-w-0 self-stretch text-inherit no-underline [-webkit-tap-highlight-color:transparent] flex-col items-stretch gap-[var(--s2)]',
    );
  });

  it('titleNodeFor: pins the title and title-action class strings for base, todo, done and action shapes', () => {
    const baseTitle = render(
      <ul>
        <ListItem title="Groceries" />
      </ul>,
    );
    expect(document.querySelector('.ui-list-item__title')!.className).toBe(
      'ui-list-item__title font-semibold leading-[var(--lh-row-title)] tracking-[var(--tracking-row-title)] text-[length:var(--fs-row-title)] truncate',
    );
    baseTitle.unmount();

    const doneTodo = render(
      <ul>
        <ListItem variant="todo" done title="Groceries" />
      </ul>,
    );
    expect(document.querySelector('.ui-list-item__title')!.className).toBe(
      'ui-list-item__title font-semibold leading-[var(--lh-row-title)] tracking-[var(--tracking-row-title)] text-[length:var(--fs-row-title)] line-clamp-2 whitespace-normal text-ink-2 line-through',
    );
    doneTodo.unmount();

    const denseTodo = render(
      <ul>
        <ListItem variant="todo" size="dense" title="Groceries" />
      </ul>,
    );
    expect(document.querySelector('.ui-list-item__title')!.className).toBe(
      'ui-list-item__title font-semibold leading-[var(--lh-row-title)] tracking-[var(--tracking-row-title)] text-[length:var(--fs-meta)] line-clamp-2 whitespace-normal',
    );
    denseTodo.unmount();

    render(
      <ul>
        <ListItem variant="nested" title="Omelette" titleAction={<span />}>
          <span />
        </ListItem>
      </ul>,
    );
    expect(document.querySelector('.ui-list-item__title')!.className).toBe(
      'ui-list-item__title ui-list-item__title--with-action font-semibold leading-[var(--lh-row-title)] tracking-[var(--tracking-row-title)] text-[length:var(--fs-row-title)] truncate flex items-stretch gap-[var(--s2)] [&>:first-child]:flex-1 [&>:first-child]:min-w-0',
    );
    expect(document.querySelector('.ui-list-item__title-action')!.className).toBe(
      'ui-list-item__title-action flex items-center shrink-0',
    );
  });

  it('subNodeFor: pins the sub, separator and snippet class strings', () => {
    const baseRow = render(
      <ul>
        <ListItem title="Groceries" meta={<time>Today</time>} snippet="milk and eggs" />
      </ul>,
    );
    expect(document.querySelector('.ui-list-item__sub')!.className).toBe(
      'ui-list-item__sub flex items-baseline gap-[var(--s1)] min-w-0 text-ink-2 text-[length:var(--fs-meta)] leading-[var(--lh-meta)] [&>time]:shrink-0 [&>time]:whitespace-nowrap',
    );
    expect(document.querySelector('.ui-list-item__sep')!.className).toBe(
      'ui-list-item__sep shrink-0 text-ink-3',
    );
    expect(document.querySelector('.ui-list-item__snippet')!.className).toBe(
      'ui-list-item__snippet min-w-0 truncate',
    );
    baseRow.unmount();

    const denseRow = render(
      <ul>
        <ListItem variant="todo" size="dense" title="Groceries" meta="Today" />
      </ul>,
    );
    expect(document.querySelector('.ui-list-item__sub')!.className).toBe(
      'ui-list-item__sub flex items-baseline gap-[var(--s1)] min-w-0 text-ink-2 text-[length:var(--fs-meta)] leading-[var(--lh-meta)] [&>time]:shrink-0 [&>time]:whitespace-nowrap',
    );
    denseRow.unmount();

    render(
      <ul>
        <ListItem variant="feedback" title="Dark mode" meta="Today" snippet="On cold load" />
      </ul>,
    );
    const subs = document.querySelectorAll('.ui-list-item__sub');
    expect(subs).toHaveLength(2);
    expect(subs[0].className).toBe(
      'ui-list-item__sub flex items-baseline gap-[var(--s1)] min-w-0 text-ink-2 text-[length:var(--fs-meta)] leading-[var(--lh-meta)] [&>time]:shrink-0 [&>time]:whitespace-nowrap',
    );
    expect(subs[1].className).toBe(
      'ui-list-item__sub flex items-baseline gap-[var(--s1)] min-w-0 text-ink-2 text-[length:var(--fs-meta)] leading-[var(--lh-meta)] [&>time]:shrink-0 [&>time]:whitespace-nowrap',
    );
    expect(document.querySelector('.ui-list-item__sep')).toBeNull();
  });

  it('rowHookClassesFor: pins the ui-list-item-- hook tokens per shape', () => {
    const hooksOf = (el: Element) => classesWithPrefix(classesOf(el), 'ui-list-item--');
    const baseRow = render(
      <ul>
        <ListItem title="Groceries" />
      </ul>,
    );
    expect(hooksOf(screen.getByRole('listitem'))).toEqual([]);
    baseRow.unmount();

    const denseDone = render(
      <ul>
        <ListItem variant="todo" size="dense" done collapsing tone="danger" title="Groceries" />
      </ul>,
    );
    expect(hooksOf(screen.getByRole('listitem'))).toEqual([
      'ui-list-item--collapsing',
      'ui-list-item--danger',
      'ui-list-item--dense',
      'ui-list-item--done',
      'ui-list-item--todo',
    ]);
    denseDone.unmount();

    render(
      <ul>
        <ListItem variant="nested" title="Omelette">
          <span />
        </ListItem>
      </ul>,
    );
    expect(hooksOf(screen.getByRole('listitem'))).toEqual(['ui-list-item--nested']);
  });

  it('rowStyleClassesFor: pins the full row class string byte-for-byte, merged with className', () => {
    const { unmount } = render(
      <ul>
        <ListItem title="Groceries" />
      </ul>,
    );
    expect(screen.getByRole('listitem').className).toBe(
      'ui-list-item flex gap-[var(--s3)] overflow-hidden active:bg-press motion-safe:transition-[height,opacity] [interpolate-size:allow-keywords] min-h-[var(--row-min-height)] px-[var(--s4)] py-[var(--s3)] items-center',
    );
    unmount();

    render(
      <ul>
        <ListItem
          variant="todo"
          size="dense"
          done
          collapsing
          tone="danger"
          className="legacy-hook"
          title="Groceries"
          deleteAction={<button>x</button>}
        />
      </ul>,
    );
    expect(screen.getByRole('listitem').className).toBe(
      'ui-list-item ui-list-item--todo ui-list-item--dense ui-list-item--done ui-list-item--collapsing ui-list-item--danger flex gap-[var(--s3)] overflow-hidden active:bg-press motion-safe:transition-[height,opacity] [interpolate-size:allow-keywords] relative min-h-[var(--tap)] ps-[var(--s3)] pe-[var(--s2)] py-[var(--s2)] [--checkbox-size:var(--s3)] [--checkbox-radius:var(--s1)] [&>.ui-checkbox]:absolute [&>.ui-checkbox]:start-[var(--s3)] [&>.ui-checkbox]:top-[var(--s2)] [&>.ui-checkbox]:justify-items-start [&>.ui-checkbox>*]:-translate-y-[calc(var(--tap)/2-var(--s2)-var(--fs-meta)*var(--lh-row-title)/2)] items-start [&>form]:flex [&>form>.ui-btn--danger]:h-auto [&>form>.ui-btn--danger]:min-h-0 [&>form>.ui-btn--danger]:w-auto [&>form>.ui-btn--danger]:min-w-0 [&>form>.ui-btn--danger]:p-[var(--s2)] [&>form>.ui-btn--danger]:rounded-[var(--r-md)] [&_.ui-icon-btn]:text-ink-3 [&_.ui-checkbox]:text-ink-3 [&_.ui-due-date]:text-ink-3 h-0 min-h-0 opacity-0 overflow-hidden legacy-hook',
    );
  });
});
