import { ArrowLeft, Trash2 } from 'lucide-react';
// React 19 types dropped the global `JSX` namespace; it is exported by `react`.
import type { JSX, ReactNode } from 'react';
import { Button } from './button';
import { ConfirmButton } from './confirm-button';
import { EmptyState } from './empty-state';
import { IconLink } from './icon-link';
import { List } from './list';
import { ListItem } from './list-item';
import { NavBar } from './nav-bar';
import { PageActions } from './page-actions';
import { PageShell } from './page-shell';
import { PageTitle } from './page-title';

export interface TrashBlockItem {
  /** Stable React key + the id passed to the bound action mappers. */
  id: string;
  /** Row title; also feeds the frozen `Restore ${title}` label by default. */
  title: string;
  /** Trailing meta line, e.g. `<LocalTime dateTime={deletedAt} />`. */
  meta?: ReactNode;
  /** Secondary line under the title. */
  snippet?: string;
}

/** A Next server action already bound to one row. */
export type TrashFormAction = (formData: FormData) => void | Promise<void>;

export interface TrashBlockProps {
  /** Page title rendered as `<h1>` (`PageTitle`). Frozen text, e.g. "Trash". */
  title: string;
  /** Back target (`IconLink` href). */
  backHref: string;
  /** Back control aria-label; default `"Back"` (frozen). */
  backLabel?: string;
  /** Rows; empty renders only the empty state. */
  items: readonly TrashBlockItem[];
  /** Empty-state body text (frozen), e.g. "Trash is empty.". */
  emptyMessage: string;
  /** Per-row restore action: returns the server action bound to that id. */
  restoreAction: (id: string) => TrashFormAction;
  /** Per-row permanent-delete action: returns the server action bound to that id. */
  deleteForeverAction: (id: string) => TrashFormAction;
  /** Confirm-dialog copy for permanent delete. */
  deleteForeverMessage: (item: TrashBlockItem) => string;
  /** The empty-trash action bound to no row. */
  emptyTrashAction: TrashFormAction;
  /** Confirm-dialog copy for emptying trash. */
  emptyTrashMessage: string;
  /** Restore button text; default `"Restore"` (frozen visible text). */
  restoreLabel?: string;
  /** Empty-trash button text; default `"Empty Trash"` (frozen visible text). */
  emptyTrashLabel?: string;
}

export function TrashBlock({
  title,
  backHref,
  backLabel = 'Back',
  items,
  emptyMessage,
  restoreAction,
  deleteForeverAction,
  deleteForeverMessage,
  emptyTrashAction,
  emptyTrashMessage,
  restoreLabel = 'Restore',
  emptyTrashLabel = 'Empty Trash',
}: Readonly<TrashBlockProps>): JSX.Element {
  return (
    <PageShell>
      <NavBar
        leading={
          <IconLink href={backHref} label={backLabel}>
            <ArrowLeft size={20} aria-hidden />
          </IconLink>
        }
      />

      <PageTitle>{title}</PageTitle>

      {items.length === 0 ? (
        <EmptyState body={emptyMessage} />
      ) : (
        <>
          <List>
            {items.map((item) => (
              <ListItem
                key={item.id}
                title={item.title}
                meta={item.meta}
                snippet={item.snippet}
                trailing={
                  <form action={restoreAction(item.id)}>
                    <Button
                      type="submit"
                      variant="quiet"
                      className="trash-restore"
                      aria-label={`${restoreLabel} ${item.title}`}
                    >
                      {restoreLabel}
                    </Button>
                  </form>
                }
                deleteAction={
                  <form action={deleteForeverAction(item.id)}>
                    <ConfirmButton
                      variant="danger"
                      className="trash-delete"
                      message={deleteForeverMessage(item)}
                    >
                      <Trash2 size={18} aria-hidden />
                    </ConfirmButton>
                  </form>
                }
              />
            ))}
          </List>
          <PageActions>
            <form action={emptyTrashAction}>
              <ConfirmButton
                variant="danger"
                size="bare"
                className="trash-empty"
                message={emptyTrashMessage}
              >
                {emptyTrashLabel}
              </ConfirmButton>
            </form>
          </PageActions>
        </>
      )}
    </PageShell>
  );
}
