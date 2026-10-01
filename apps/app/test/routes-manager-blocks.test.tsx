import type { List } from '@life/shared';
import { ManagerBlock, Switch } from '@life/ui';

jest.mock('@/app/todo-actions', () => ({
  createListAction: jest.fn(),
  deleteListAction: jest.fn(),
  renameListAction: jest.fn(),
}));

import { renameListAction } from '@/app/todo-actions';
import { ListManagerPanel } from '@/app/list-manager-panel';
import { TagManagerSection } from '@/app/tag-manager-section';
import { ListManagerSection } from '@/app/list-manager-section';
import NotesTagsPage from '@/app/notes/tags/page';
import TodosTagsPage from '@/app/todos/tags/page';
import TodosListsPage from '@/app/todos/lists/page';

const mockedRenameListAction = renameListAction as jest.MockedFunction<typeof renameListAction>;

function list(overrides: Partial<List> = {}): List {
  return {
    id: 'l1',
    name: 'Groceries',
    importantDefault: null,
    version: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('manager-page routes on ManagerBlock', () => {
  it('/notes/tags renders ManagerBlock titled Tags backed to /notes', () => {
    const el = NotesTagsPage();

    expect(el.type).toBe(ManagerBlock);
    expect(el.props.title).toBe('Tags');
    expect(el.props.backHref).toBe('/notes');
    expect(el.props.children.type).toBe(TagManagerSection);
  });

  it('/todos/tags renders ManagerBlock titled Tags backed to /todos', () => {
    const el = TodosTagsPage();

    expect(el.type).toBe(ManagerBlock);
    expect(el.props.title).toBe('Tags');
    expect(el.props.backHref).toBe('/todos');
    expect(el.props.children.type).toBe(TagManagerSection);
  });

  it('/todos/lists renders ManagerBlock titled Lists backed to /todos', () => {
    const el = TodosListsPage();

    expect(el.type).toBe(ManagerBlock);
    expect(el.props.title).toBe('Lists');
    expect(el.props.backHref).toBe('/todos');
    expect(el.props.children.type).toBe(ListManagerSection);
  });
});

describe('ListManagerPanel importance-default Switch', () => {
  beforeEach(() => jest.clearAllMocks());

  const rowExtraFor = (lists: List[], id: string, name = 'Groceries') => {
    const el = ListManagerPanel({ lists });
    return el.props.rowExtra({ id, name });
  };

  it.each([
    [true, true],
    [false, false],
    [null, false],
  ])('checks the Switch from importantDefault %p → %p', (importantDefault, expected) => {
    const lists = [list({ importantDefault: importantDefault as boolean | null })];
    const node = rowExtraFor(lists, 'l1');

    expect(node.type).toBe(Switch);
    expect(node.props.label).toBe('Default important');
    expect(node.props.checked).toBe(expected);
  });

  it('sends the next value and the list version through renameListAction', () => {
    const lists = [list({ importantDefault: true, version: 7 })];
    const node = rowExtraFor(lists, 'l1');

    node.props.onCheckedChange(false);
    expect(mockedRenameListAction).toHaveBeenCalledWith('l1', 'Groceries', false, 7);

    node.props.onCheckedChange(true);
    expect(mockedRenameListAction).toHaveBeenCalledWith('l1', 'Groceries', true, 7);
  });

  it('renames with the list current default and version', () => {
    const lists = [list({ importantDefault: true, version: 3 })];
    const el = ListManagerPanel({ lists });

    el.props.onRename('l1', 'Food');

    expect(mockedRenameListAction).toHaveBeenCalledWith('l1', 'Food', true, 3);
  });
});
