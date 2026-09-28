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
import { listTrash } from '@/lib/api';
import { splitBody } from '../../note-title';
import { deleteForeverAction, emptyTrashAction, restoreNoteAction } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function TrashPage() {
  const { notes } = await listTrash();

  return (
    <PageShell>
      <NavBar
        leading={
          <IconLink href="/notes" label="Back">
            <ArrowLeft size={20} aria-hidden />
          </IconLink>
        }
      />

      <PageTitle>Trash</PageTitle>

      {notes.length === 0 ? (
        <EmptyState body="Trash is empty." />
      ) : (
        <>
          <List>
            {notes.map((note) => {
              const { title, snippet } = splitBody(note.body);
              return (
                <ListItem
                  key={note.id}
                  title={title}
                  meta={note.deletedAt ? <LocalTime dateTime={note.deletedAt} /> : undefined}
                  snippet={snippet || undefined}
                  trailing={
                    <form action={restoreNoteAction.bind(null, note.id)}>
                      <Button
                        type="submit"
                        variant="quiet"
                        className="trash-restore"
                        aria-label={`Restore ${title}`}
                      >
                        Restore
                      </Button>
                    </form>
                  }
                  deleteAction={
                    <form action={deleteForeverAction.bind(null, note.id)}>
                      <ConfirmButton
                        variant="danger"
                        className="trash-delete"
                        message="Delete this note forever? This cannot be undone."
                      >
                        <Trash2 size={18} aria-hidden />
                      </ConfirmButton>
                    </form>
                  }
                />
              );
            })}
          </List>
          <PageActions>
            <form action={emptyTrashAction}>
              <ConfirmButton
                variant="danger"
                size="bare"
                className="trash-empty"
                message="Permanently delete all notes in trash? This cannot be undone."
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
