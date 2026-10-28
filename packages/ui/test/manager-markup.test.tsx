import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ListManager } from '../src/components/list-manager';
import { TagManager } from '../src/components/tag-manager';

const LISTS = [
  { id: 'l1', name: 'Groceries' },
  { id: 'l2', name: 'Work' },
];
const TAGS = [
  { id: 1, name: 'home' },
  { id: 2, name: 'errand' },
];

const noop = () => {};

/**
 * The manager markup is a frozen surface: `ListManager` and `TagManager` share one
 * `ManagerSurface`, and these snapshots are the element-by-element record of the rows
 * both render. The row menu is registry `dropdown-menu` markup, so its trigger opens on
 * a primary press that jsdom can only express as a mouse event of that type.
 */
function press(name: string) {
  fireEvent(
    screen.getByRole('button', { name: `Actions for ${name}` }),
    new MouseEvent('pointerdown', { bubbles: true, button: 0 }),
  );
}
function snapshot(node: React.ReactElement, act?: () => void) {
  const { container } = render(node);
  act?.();
  const html = container.innerHTML;
  cleanup();
  expect(html).toMatchSnapshot();
}

describe('manager markup', () => {
  it('renders the list manager', () => {
    snapshot(<ListManager lists={LISTS} onCreate={noop} onRename={noop} onDelete={noop} />);
  });

  it('renders the list manager disabled', () => {
    snapshot(
      <ListManager lists={LISTS} onCreate={noop} onRename={noop} onDelete={noop} disabled />,
    );
  });

  it('renders the list manager with rowExtra', () => {
    snapshot(
      <ListManager
        lists={LISTS}
        onCreate={noop}
        onRename={noop}
        onDelete={noop}
        rowExtra={(list) => <span data-extra={list.id}>extra-{list.name}</span>}
      />,
    );
  });

  it('renders the list manager with custom copy and classes', () => {
    snapshot(
      <ListManager
        lists={[]}
        onCreate={noop}
        onRename={noop}
        onDelete={noop}
        label="L"
        placeholder="P"
        createLabel="C"
        className="x"
        data-probe="1"
      />,
    );
  });

  it('renders the list manager with its menu open', () => {
    snapshot(
      <ListManager lists={LISTS} onCreate={noop} onRename={noop} onDelete={noop} />,
      () => press('Groceries'),
    );
  });

  it('renders the list manager with the inline editor open', () => {
    snapshot(
      <ListManager lists={LISTS} onCreate={noop} onRename={noop} onDelete={noop} />,
      () => {
        press('Groceries');
        fireEvent.click(screen.getByRole('button', { name: 'Rename list Groceries' }));
      },
    );
  });

  it('renders the tag manager', () => {
    snapshot(<TagManager tags={TAGS} onCreate={noop} onRename={noop} onDelete={noop} />);
  });

  it('renders the tag manager disabled', () => {
    snapshot(<TagManager tags={TAGS} onCreate={noop} onRename={noop} onDelete={noop} disabled />);
  });

  it('renders the tag manager with custom copy and classes', () => {
    snapshot(
      <TagManager
        tags={[]}
        onCreate={noop}
        onRename={noop}
        onDelete={noop}
        label="L"
        placeholder="P"
        createLabel="C"
        className="y"
      />,
    );
  });

  it('renders the tag manager with its menu open', () => {
    snapshot(
      <TagManager tags={TAGS} onCreate={noop} onRename={noop} onDelete={noop} />,
      () => press('home'),
    );
  });

  it('renders the tag manager with the inline editor open', () => {
    snapshot(
      <TagManager tags={TAGS} onCreate={noop} onRename={noop} onDelete={noop} />,
      () => {
        press('home');
        fireEvent.click(screen.getByRole('button', { name: 'Rename tag home' }));
      },
    );
  });
});
