import { ArrowLeft, Trash2 } from 'lucide-react';
import {
  Button,
  ConfirmButton,
  EmptyState,
  IconLink,
  List,
  ListItem,
  LocalTime,
  NavBar,
  PageActions,
  PageShell,
  PageTitle,
} from '@life/ui';
import { listTodoTrash } from '@/lib/todo-api';
import {
  deleteForeverTodoAction,
  emptyTodoTrashAction,
  restoreTodoAction,
} from '../../todo-actions';

export const dynamic = 'force-dynamic';

export default async function TrashPage() {
  const { todos } = await listTodoTrash();

  return (
    <PageShell>
      <NavBar
        leading={
          <IconLink href="/todos" label="Back">
            <ArrowLeft size={20} aria-hidden />
          </IconLink>
        }
      />

      <PageTitle>Trash</PageTitle>

      {todos.length === 0 ? (
        <EmptyState body="Trash is empty." />
      ) : (
        <>
          <List>
            {todos.map((todo) => (
              <ListItem
                key={todo.id}
                title={todo.title}
                meta={todo.deletedAt ? <LocalTime dateTime={todo.deletedAt} /> : undefined}
                snippet={todo.note ?? undefined}
                trailing={
                  <form action={restoreTodoAction.bind(null, todo.id)}>
                    <Button
                      type="submit"
                      variant="quiet"
                      className="trash-restore"
                      aria-label={`Restore ${todo.title}`}
                    >
                      Restore
                    </Button>
                  </form>
                }
                deleteAction={
                  <form action={deleteForeverTodoAction.bind(null, todo.id)}>
                    <ConfirmButton
                      variant="danger"
                      className="trash-delete"
                      message="Delete this todo forever? This cannot be undone."
                    >
                      <Trash2 size={18} aria-hidden />
                    </ConfirmButton>
                  </form>
                }
              />
            ))}
          </List>
          <PageActions>
            <form action={emptyTodoTrashAction}>
              <ConfirmButton
                variant="danger"
                size="bare"
                className="trash-empty"
                message="Permanently delete all todos in trash? This cannot be undone."
              >
                Empty Trash
              </ConfirmButton>
            </form>
          </PageActions>
        </>
      )}
    </PageShell>
  );
}
