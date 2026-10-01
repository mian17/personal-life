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
});
