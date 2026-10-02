import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { ListItem } from '../src/components/list-item';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('ListItem', () => {
  it('renders an <li> row with the ui-list-item class', () => {
    render(
      <ul>
        <ListItem title="Groceries" />
      </ul>,
    );
    const li = screen.getByRole('listitem');
    expect(li.tagName).toBe('LI');
    expect(classesOf(li)).toEqual(['ui-list-item']);
  });

  it('renders href as a link carrying the ui-list-item__link class', () => {
    render(
      <ul>
        <ListItem href="/notes/1" title="Groceries" />
      </ul>,
    );
    const link = screen.getByRole('link');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/notes/1');
    expect(classesOf(link)).toEqual(['ui-list-item__link']);
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

  it('applies the legacy `.note form` display rule through a descendant slot rule', () => {
    const css = readFileSync(join(__dirname, '..', 'src', 'styles', 'blocks.css'), 'utf8');
    expect(css).toMatch(/\.ui-list-item\s+form\s*\{[^}]*display:\s*flex/);
  });

  it('centres row action slots while the row link stretches to full height', () => {
    const css = readFileSync(join(__dirname, '..', 'src', 'styles', 'blocks.css'), 'utf8');
    const block = (selector: string) =>
      (css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)) ??
        [])[1] ?? '';

    const row = block('.ui-list-item');
    expect(row).toMatch(/align-items:\s*center/);
    expect(row).toMatch(/min-height:\s*calc\(/);
    const minHeight = row.match(/min-height:\s*([^;]+);/)?.[1] ?? '';
    expect(minHeight).not.toMatch(/\d+(px|rem)/);
    expect(block('.ui-list-item__link')).toMatch(/align-self:\s*stretch/);
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
    expect(classesOf(screen.getByRole('listitem'))).toEqual([
      'ui-list-item',
      'ui-list-item--dense',
      'ui-list-item--todo',
    ]);

    const css = readFileSync(join(__dirname, '..', 'src', 'styles', 'blocks.css'), 'utf8');
    const denseBlock = (selector: string) =>
      (css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)) ??
        [])[1] ?? '';

    for (const part of ['title', 'sub']) {
      const block = denseBlock(`.ui-list-item--dense .ui-list-item__${part}`);
      const fontSize = block.match(/font-size:\s*([^;]+);/)?.[1] ?? '';
      expect(fontSize).toMatch(/var\(--space-/);
      expect(fontSize).not.toMatch(/\d+(px|rem)/);
    }

    expect(denseBlock('.ui-list-item--dense')).toMatch(/min-height:\s*0/);
    expect(denseBlock('.ui-list-item--dense')).toMatch(
      /--checkbox-size:\s*var\(--space-0-75\)/,
    );
    const padding =
      denseBlock('.ui-list-item--dense .ui-list-item__link').match(/padding:\s*([^;]+);/)?.[1] ?? '';
    expect(padding).toMatch(/var\(--space-/);
    expect(padding).not.toMatch(/\d+(px|rem)/);
  });

  it('puts the 2-line title clamp on the todo variant, not the dense scale', () => {
    const css = readFileSync(join(__dirname, '..', 'src', 'styles', 'blocks.css'), 'utf8');
    const block = (selector: string) =>
      (css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)) ??
        [])[1] ?? '';

    const todoTitle = block('.ui-list-item--todo .ui-list-item__title');
    expect(todoTitle).toMatch(/-webkit-line-clamp:\s*2/);
    expect(todoTitle).toMatch(/display:\s*-webkit-box/);
    expect(todoTitle).toMatch(/white-space:\s*normal/);

    const denseTitle = block('.ui-list-item--dense .ui-list-item__title');
    expect(denseTitle).not.toMatch(/-webkit-line-clamp/);
    expect(denseTitle).not.toMatch(/display:\s*-webkit-box/);
  });

  it('adds the todo variant alone: 20px checkbox, auto-sized leading toggle, token padding', () => {
    render(
      <ul>
        <ListItem variant="todo" title="Groceries" />
      </ul>,
    );
    expect(classesOf(screen.getByRole('listitem'))).toEqual([
      'ui-list-item',
      'ui-list-item--todo',
    ]);

    const css = readFileSync(join(__dirname, '..', 'src', 'styles', 'blocks.css'), 'utf8');
    const block = (selector: string) =>
      (css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)) ??
        [])[1] ?? '';

    expect(block('.ui-list-item--todo')).toMatch(
      /--checkbox-size:\s*var\(--space-1-25\)/,
    );
    /* The default todo row inherits the base centre. */
    expect(block('.ui-list-item--todo')).not.toMatch(/flex-start/);

    const iconBtn = block('.ui-list-item--todo .ui-icon-btn');
    expect(iconBtn).toMatch(/width:\s*auto/);
    expect(iconBtn).toMatch(/height:\s*auto/);
    /* Four-value all-token shorthand: the left inset is a token size. */
    expect(iconBtn).toMatch(
      /padding:\s*var\(--space-[\w-]+\)\s+0\s+var\(--space-[\w-]+\)\s+var\(--space-[\w-]+\)/,
    );
    const padding = iconBtn.match(/padding:\s*([^;]+);/)?.[1] ?? '';
    expect(padding).toMatch(/var\(--space-/);
    expect(padding).not.toMatch(/\d+(px|rem)/);

    /* The dense (matrix) scale stays top-aligned. */
    expect(block('.ui-list-item--dense')).toMatch(/align-items:\s*flex-start/);
  });

  it('treats size="dense" without the todo variant as a no-op', () => {
    render(
      <ul>
        <ListItem size="dense" title="Groceries" />
      </ul>,
    );
    expect(classesOf(screen.getByRole('listitem'))).toEqual(['ui-list-item']);
  });

  it('adds a tone class for a coloured lens row, and none without a tone', () => {
    const { unmount } = render(
      <ul>
        <ListItem tone="danger" title="Groceries" />
      </ul>,
    );
    expect(classesOf(screen.getByRole('listitem'))).toEqual([
      'ui-list-item',
      'ui-list-item--danger',
    ]);
    unmount();

    render(
      <ul>
        <ListItem title="Groceries" />
      </ul>,
    );
    expect(classesOf(screen.getByRole('listitem'))).toEqual(['ui-list-item']);
  });

  it('merges className instead of replacing it', () => {
    render(
      <ul>
        <ListItem className="legacy-hook" title="Groceries" />
      </ul>,
    );
    expect(classesOf(screen.getByRole('listitem'))).toEqual(['legacy-hook', 'ui-list-item']);
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
    expect(classesOf(screen.getByRole('listitem'))).toEqual([
      'ui-list-item',
      'ui-list-item--done',
    ]);
  });

  it('adds the collapsing class while hiding', () => {
    render(
      <ul>
        <ListItem collapsing title="Groceries" />
      </ul>,
    );
    expect(classesOf(screen.getByRole('listitem'))).toEqual([
      'ui-list-item',
      'ui-list-item--collapsing',
    ]);
  });

  const blocksCss = () => readFileSync(join(__dirname, '..', 'src', 'styles', 'blocks.css'), 'utf8');
  const cssBlock = (css: string, selector: string) =>
    (css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)) ??
      [])[1] ?? '';

  it('strikes and mutes the done title through tokens', () => {
    const block = cssBlock(blocksCss(), '.ui-list-item--done .ui-list-item__title');
    expect(block).toMatch(/color:\s*var\(--muted\)/);
    expect(block).toMatch(/text-decoration:\s*line-through/);
  });

  it('mutes a completed toned row uniformly: the tone rules yield to --done', () => {
    const doneIcon = cssBlock(blocksCss(), '.ui-list-item--done .ui-icon-btn');
    expect(doneIcon).toMatch(/color:\s*var\(--muted\)/);
    for (const tone of ['danger', 'amber', 'accent']) {
      expect(blocksCss()).toContain(`.ui-list-item--${tone}:not(.ui-list-item--done) .ui-icon-btn`);
    }
  });

  it('tints the todo checkbox: the tone rule wins the cascade on the leading control', () => {
    const css = blocksCss();
    const classCount = (selector: string) => (selector.match(/\.[\w-]+/g) ?? []).length;

    // The todo row's leading toggle must not reset the colour the tone sets.
    expect(cssBlock(css, '.ui-list-item--todo .ui-icon-btn')).not.toContain('color');

    for (const tone of ['danger', 'amber', 'accent']) {
      const selector = `.ui-list-item--${tone}:not(.ui-list-item--done) .ui-icon-btn`;
      const rule = cssBlock(css, selector);
      // The tint is declared on the control that leads the row ...
      expect(rule).toMatch(new RegExp(`color:\\s*var\\(--${tone}\\)`));
      // ... and the selector outranks the base `.ui-icon-btn` colour, so it wins.
      expect(classCount(selector)).toBeGreaterThan(classCount('.ui-icon-btn'));
    }

    const atoms = readFileSync(join(__dirname, '..', 'src', 'styles', 'atoms.css'), 'utf8');
    expect(cssBlock(atoms, '.ui-icon-btn')).toMatch(/color:\s*var\(--text\)/);
    // The square glyph inherits that colour, so the tint reaches the checkbox.
    const checkbox = cssBlock(atoms, '.ui-checkbox');
    expect(checkbox).toMatch(/color:\s*inherit/);
    expect(checkbox).toMatch(/border:[^;]*currentColor/);
  });

  it('applies one done treatment at both todo sizes, muting the signal due date too', () => {
    const { unmount } = render(
      <ul>
        <ListItem variant="todo" done title="Groceries" />
      </ul>,
    );
    expect(classesOf(screen.getByRole('listitem'))).toContain('ui-list-item--done');
    unmount();

    render(
      <ul>
        <ListItem variant="todo" size="dense" done title="Groceries" />
      </ul>,
    );
    const classes = classesOf(screen.getByRole('listitem'));
    expect(classes).toContain('ui-list-item--done');
    expect(classes).toContain('ui-list-item--dense');

    // The done rules key off `--done`, never a size, so default and dense share
    // one treatment — and it mutes the signal due date as well as the title.
    const css = blocksCss();
    expect(cssBlock(css, '.ui-list-item--done .ui-due-date')).toMatch(/color:\s*var\(--muted\)/);
  });

  it('collapses the row to zero height while hiding', () => {
    const block = cssBlock(blocksCss(), '.ui-list-item--collapsing');
    expect(block).toMatch(/height:\s*0/);
    expect(block).toMatch(/min-height:\s*0/);
  });

  it('transitions the base row through the motion tokens', () => {
    const block = cssBlock(blocksCss(), '.ui-list-item');
    expect(block).toMatch(/transition:[^;]*var\(--duration-base\)/);
    expect(block).toMatch(/transition:[^;]*var\(--ease-standard\)/);
  });

  it('owns the empty-section rule for an all-removed group', () => {
    expect(blocksCss()).toMatch(
      /\.ui-section:has\(\.ui-list\):not\(:has\(\.ui-list-item\)\)\s*\{[^}]*display:\s*none/,
    );
  });
});
