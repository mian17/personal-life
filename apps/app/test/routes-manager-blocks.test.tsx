import { ManagerBlock } from '@life/ui';
import { TagManagerSection } from '@/app/tag-manager-section';
import { ListManagerSection } from '@/app/list-manager-section';
import NotesTagsPage from '@/app/notes/tags/page';
import TodosTagsPage from '@/app/todos/tags/page';
import TodosListsPage from '@/app/todos/lists/page';

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
