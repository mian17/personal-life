'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { Note } from '@life/shared';
import {
  AlertBanner,
  Button,
  EditorChrome,
  Menu,
  MenuItem,
  StatusText,
  Textarea,
  type TagOption,
} from '@life/ui';
import { deleteNoteAction } from './actions';
import { hasUncommittedTrailingTag, parseInlineTags } from '@/lib/inline-tags';

type Status = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';
type ParseMode = 'strict' | 'final';
type FlushResponse = {
  id?: string;
  version?: number;
  tagIds?: number[];
  note?: Note;
  error?: string;
};

const STATUS_TEXT: Record<Status, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  error: "Couldn't save",
  conflict: 'Changed on another device',
};

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** A ref cell, narrowed to what the drain needs (no React version coupling). */
interface Cell<T> {
  current: T;
}

/** Everything one drain iteration reads and writes, so it can live at module scope. */
export interface DrainContext {
  idRef: Cell<string | null>;
  bodyRef: Cell<string>;
  selectedRef: Cell<number[]>;
  versionRef: Cell<number>;
  dirtyRef: Cell<boolean>;
  modeRef: Cell<ParseMode>;
  sentRef: Cell<{ body: string; tagIds: number[] } | null>;
  inFlightRef: Cell<boolean>;
  setSelectedIds: (ids: number[]) => void;
  setStatus: (status: Status) => void;
  enterConflict: (server: Note) => void;
}

/**
 * An empty body is not a failure on a new note (nothing was created) but is one
 * on an existing note, so leaving cannot look like a saved clear.
 */
function settleEmptyBody(ctx: DrainContext, id: string | null): boolean {
  ctx.sentRef.current = null;
  if (id === null) {
    ctx.dirtyRef.current = false;
    return true;
  }
  ctx.dirtyRef.current = true;
  ctx.setStatus('error');
  return false;
}

/** A failed flush stays dirty for a later retry, but must not spin the drain. */
function settleFailure(ctx: DrainContext): void {
  ctx.sentRef.current = null;
  ctx.dirtyRef.current = true;
  ctx.setStatus('error');
}

/** 409: stop the drain and keep the local edit for the user's choice. */
async function settleConflict(ctx: DrainContext, res: Response): Promise<void> {
  // The response carries the current server note so the user can choose without
  // another request.
  let server: Note | null = null;
  try {
    const data = (await res.json()) as FlushResponse;
    server = data.note ?? null;
  } catch {
    server = null;
  }
  if (server) ctx.enterConflict(server);
  else settleFailure(ctx);
}

/** Fold a successful flush response into the refs and the status. */
function settleSaved(ctx: DrainContext, data: FlushResponse, id: string | null): void {
  if (id === null && typeof data.id === 'string') {
    ctx.idRef.current = data.id;
    // replaceState, not router.replace: a router transition is exactly what used
    // to remount the editor and reset the caret.
    window.history.replaceState(null, '', `/notes/${data.id}`);
  }
  if (typeof data.version === 'number') ctx.versionRef.current = data.version;
  if (Array.isArray(data.tagIds)) {
    // The server returns the ids that actually persisted; a tag deleted
    // elsewhere was omitted and is detached here too.
    ctx.selectedRef.current = data.tagIds;
    ctx.setSelectedIds(data.tagIds);
  }
  const sent = ctx.sentRef.current;
  ctx.sentRef.current = null;
  const changed =
    ctx.bodyRef.current !== sent?.body ||
    !sameIds(ctx.selectedRef.current, sent?.tagIds ?? []);
  if (ctx.dirtyRef.current || changed) {
    // Latest-wins: a newer edit arrived during the request.
    ctx.dirtyRef.current = true;
    return;
  }
  ctx.setStatus('saved');
}

/** Fold one flush response into the editor state; `true` means the save failed. */
async function settleResponse(ctx: DrainContext, res: Response, id: string | null): Promise<boolean> {
  if (res.status === 409) {
    await settleConflict(ctx, res);
    return true;
  }
  if (!res.ok) {
    settleFailure(ctx);
    return true;
  }
  settleSaved(ctx, (await res.json()) as FlushResponse, id);
  return false;
}

/** One flush request for `nextBody`/`nextTagIds`; `true` means it failed. */
async function flushPendingBody(
  ctx: DrainContext,
  id: string | null,
  nextBody: string,
  nextTagIds: number[],
): Promise<boolean> {
  try {
    // A route-handler fetch, unlike a Server Action, does not refresh the RSC tree
    // of the current route, so the editor is never remounted mid-edit.
    const res = await fetch(id === null ? '/api/notes/flush' : `/api/notes/${id}/flush`, {
      method: id === null ? 'POST' : 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: nextBody,
        inlineTagNames: parseInlineTags(nextBody, {
          eofTerminates: ctx.modeRef.current === 'final',
        }),
        tagIds: nextTagIds,
        ...(id === null ? {} : { expectedVersion: ctx.versionRef.current }),
      }),
    });
    return await settleResponse(ctx, res, id);
  } catch {
    settleFailure(ctx);
    return true;
  }
}

/**
 * One drain iteration: a clean editor is done, an empty body settles without a
 * request, otherwise one flush runs. `true` means the editor may be left clean.
 *
 * Exported so the state machine can be pinned without a DOM (`test/note-drain`);
 * it reads and writes through `ctx` refs, never through React.
 */
export async function drainOnce(ctx: DrainContext): Promise<boolean> {
  if (!ctx.dirtyRef.current) return true;
  const id = ctx.idRef.current;
  const nextBody = ctx.bodyRef.current;
  const nextTagIds = ctx.selectedRef.current;
  if (!nextBody.trim()) return settleEmptyBody(ctx, id);
  ctx.dirtyRef.current = false;
  ctx.sentRef.current = { body: nextBody, tagIds: nextTagIds };
  ctx.setStatus('saving');
  ctx.inFlightRef.current = true;
  try {
    return !(await flushPendingBody(ctx, id, nextBody, nextTagIds));
  } finally {
    ctx.inFlightRef.current = false;
  }
}

/**
 * The editor's tag state is the attached `tagIds`. Inline `#tag` names are
 * parsed from the body (strict grammar: a token is a tag only when a terminator
 * follows it, so autosave never commits a half-typed token) and sent alongside
 * the attached ids; the flush route resolves both through the registry's
 * create-or-get and persists `tagIds`. A final save (blur, Back/Save, pagehide,
 * Keep mine) parses with `eofTerminates` so a note ending on `#tag` still
 * commits it. Unresolvable ids (a tag deleted in the other app) come back in
 * the response's `tagIds` as the detached set, and rendering omits them.
 */
export function NoteEditor({ note, availableTags }: Readonly<{ note?: Note; availableTags: TagOption[] }>) {
  const router = useRouter();
  const [body, setBody] = useState(note?.body ?? '');
  const [selectedIds, setSelectedIds] = useState<number[]>(note?.tagIds ?? []);
  const [status, setStatus] = useState<Status>('idle');
  const [conflictNote, setConflictNote] = useState<Note | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const dirtyRef = useRef(false);
  const modeRef = useRef<ParseMode>('strict');
  const idRef = useRef<string | null>(note?.id ?? null);
  const bodyRef = useRef(note?.body ?? '');
  const selectedRef = useRef<number[]>(note?.tagIds ?? []);
  // Server version last seen from a successful read/write; sent as expectedVersion
  // so a PATCH from a stale tab is rejected (409) instead of silently overwriting.
  const versionRef = useRef(note?.version ?? 0);
  // The server note that won the race. Kept in a ref so save()/leave() can read it
  // synchronously, and in state so the conflict bar renders.
  const conflictRef = useRef<Note | null>(null);
  // The body/ids the in-flight request is persisting, so a newer edit can win.
  const sentRef = useRef<{ body: string; tagIds: number[] } | null>(null);
  // One shared drain promise: concurrent calls (debounce + blur + explicit Save)
  // coalesce instead of each forcing a redundant request, and every joiner sees the
  // same success boolean.
  const drainRef = useRef<Promise<boolean> | null>(null);

  const enterConflict = useCallback((server: Note) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    conflictRef.current = server;
    setConflictNote(server);
    // The local edit is retained (dirty) but autosave stays paused until the user
    // picks Load latest or Keep mine; a retry with the same stale version would
    // only 409 again.
    dirtyRef.current = true;
    sentRef.current = null;
    setStatus('conflict');
  }, []);

  const save = useCallback((mode: ParseMode = 'strict'): Promise<boolean> => {
    // A final save upgrades the drain's parse and forces a send when the body is
    // clean but ends on a tag the strict parse would not commit (D14). Runs before
    // the `running`/`dirtyRef` guards, so it applies whether we start or join a drain.
    if (mode === 'final') {
      modeRef.current = 'final';
      if (hasUncommittedTrailingTag(bodyRef.current)) dirtyRef.current = true;
    }
    const running = drainRef.current;
    if (running) return running;
    if (conflictRef.current) {
      // No drain runs on this path to consume a 'final' upgrade: reset it so the
      // next strict autosave cannot parse with eofTerminates and commit a
      // half-typed trailing token. Safe because `running` was null above.
      modeRef.current = 'strict';
      return Promise.resolve(false);
    }
    const ctx: DrainContext = {
      idRef,
      bodyRef,
      selectedRef,
      versionRef,
      dirtyRef,
      modeRef,
      sentRef,
      inFlightRef,
      setSelectedIds,
      setStatus,
      enterConflict,
    };
    // A failure stays dirty for a later retry, but must not spin here.
    // Recursive rather than a `while` around an `await`: each turn must observe
    // the refs after the previous flush settled, so the turns are sequential by
    // necessity. The named function expression keeps `drain` the promise.
    const drain = (async function drainLoop(): Promise<boolean> {
      const clean = await drainOnce(ctx);
      return clean && dirtyRef.current ? drainLoop() : clean;
    })();
    drainRef.current = drain;
    void drain.finally(() => {
      if (drainRef.current === drain) drainRef.current = null;
      modeRef.current = 'strict';
    });
    return drain;
  }, [enterConflict]);

  const flush = useCallback(
    (mode: ParseMode = 'strict'): Promise<boolean> => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return save(mode);
    },
    [save],
  );

  // Client-side navigation does not fire pagehide, so leaving flushes the
  // pending debounced save (creating a non-empty new note) before navigating home.
  const leave = useCallback(async () => {
    const ok = await flush('final');
    if (ok) router.push('/notes');
  }, [flush, router]);

  // Server Actions do not survive navigation, so a pending edit is sent via a
  // keepalive fetch that the browser finishes after the page is gone.
  const flushKeepalive = useCallback((allowCreate: boolean, mode: ParseMode) => {
    // Hidden-but-alive (tab switch, app background): a new note must not be
    // created here, because idRef and the URL stay null/'/notes/new'. Returning
    // to type would then POST again and duplicate it.
    if (idRef.current === null && !allowCreate) return;
    const nextBody = bodyRef.current;
    const nextTagIds = selectedRef.current;
    // Final mode commits a trailing tag a clean body would otherwise never send
    // (D14) — before the `!dirtyRef.current` guards below.
    if (mode === 'final' && hasUncommittedTrailingTag(nextBody)) dirtyRef.current = true;
    // A drain already running re-reads modeRef on its next iteration; upgrade it so
    // that iteration parses final too (the in-flight request already left strict).
    // Gated on a live drain so the flag is only ever set where it will be consumed
    // and reset in that drain's finally — never leaks to a later strict autosave.
    if (mode === 'final' && drainRef.current) modeRef.current = 'final';
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const fail = () => {
      dirtyRef.current = true;
      setStatus('error');
    };
    const send = (url: string, method: 'POST' | 'PATCH') => {
      dirtyRef.current = false;
      const payload: {
        body: string;
        inlineTagNames: string[];
        tagIds: number[];
        expectedVersion?: number;
      } = {
        body: nextBody,
        inlineTagNames: parseInlineTags(nextBody, { eofTerminates: mode === 'final' }),
        tagIds: nextTagIds,
      };
      // Best-effort concurrency guard: a stale keepalive PATCH must not clobber
      // another writer. A conflict here only marks the editor paused, never retries.
      if (method === 'PATCH') payload.expectedVersion = versionRef.current;
      void fetch(url, {
        method,
        keepalive: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(async (res) => {
          if (res.ok) return;
          if (res.status === 409) {
            try {
              const data = (await res.json()) as FlushResponse;
              if (data.note) enterConflict(data.note);
              else fail();
            } catch {
              fail();
            }
            return;
          }
          fail();
        })
        .catch(fail);
    };
    if (idRef.current === null) {
      // A create already in flight carries this note; a second POST would
      // duplicate it. A non-dirty note was already flushed this lifecycle.
      if (inFlightRef.current || !dirtyRef.current || !nextBody.trim()) return;
      send('/api/notes/flush', 'POST');
      return;
    }
    if (!dirtyRef.current) return;
    if (!nextBody.trim()) {
      fail();
      return;
    }
    // Send even while a save is in flight: if an older PATCH lands after this
    // newer body, save() re-issues the latest body once it resolves.
    send(`/api/notes/${idRef.current}/flush`, 'PATCH');
  }, [enterConflict]);

  function schedule() {
    dirtyRef.current = true;
    // While conflicted, hold the debounce: autosaving with a stale version only
    // re-409s, and the user has an explicit choice to make first.
    if (conflictRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void save();
    }, 400);
  }

  function toggleTag(id: number) {
    const next = selectedRef.current.includes(id)
      ? selectedRef.current.filter((current) => current !== id)
      : [...selectedRef.current, id];
    selectedRef.current = next;
    setSelectedIds(next);
    schedule();
  }

  const loadLatest = useCallback(() => {
    const server = conflictRef.current;
    if (!server) return;
    conflictRef.current = null;
    setConflictNote(null);
    bodyRef.current = server.body;
    setBody(server.body);
    selectedRef.current = server.tagIds;
    setSelectedIds(server.tagIds);
    versionRef.current = server.version;
    dirtyRef.current = false;
    sentRef.current = null;
    setStatus('idle');
  }, []);

  const keepMine = useCallback(() => {
    const server = conflictRef.current;
    if (!server) return;
    // Adopt the server's current version and force the overwrite in one PATCH.
    versionRef.current = server.version;
    conflictRef.current = null;
    setConflictNote(null);
    dirtyRef.current = true;
    sentRef.current = null;
    setStatus('saving');
    void save('final');
  }, [save]);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      // Browser form restoration can repopulate the DOM textarea after a
      // pagehide create without React state knowing, so a restored draft would
      // masquerade as new input and POST a duplicate note.
      if (el.value !== bodyRef.current) el.value = bodyRef.current;
      el.focus();
      el.setSelectionRange(0, 0);
    }
  }, []);

  useEffect(() => {
    function onPageHide() {
      flushKeepalive(true, 'final');
    }
    function onVisibility() {
      if (document.visibilityState === 'hidden') flushKeepalive(false, 'final');
    }
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [flushKeepalive]);

  // Deleting supersedes any pending autosave, so the pending debounce is dropped and
  // the editor returns to the index without a flush: a write racing the delete would
  // only resurrect the row.
  const removeNote = useCallback(async () => {
    if (note == null) return;
    setMenuOpen(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    dirtyRef.current = false;
    await deleteNoteAction(note.id);
    router.push('/notes');
  }, [note, router]);

  // Render every registry tag in the picker (the attach/detach surface). Inline
  // `#tag` names not yet in the registry are created by the flush route's
  // create-or-get, so the picker never needs a create affordance here.
  return (
    <EditorChrome
      back={{ label: 'Back', onBack: () => void leave(), variant: 'framed' }}
      // The toolbar owns the screen's `<h1>`; without a title these two screens were
      // headed-less. "New note" is the wording the index FAB already uses.
      title={note == null ? 'New note' : 'Edit note'}
      // A title replaces the status slot in the toolbar, so the save read-out moves
      // to the sub-line — same `StatusText`, so it keeps its live region.
      sub={<StatusText>{STATUS_TEXT[status]}</StatusText>}
      actions={
        note != null && (
          <Menu
            label="Note actions"
            open={menuOpen}
            onOpenChange={setMenuOpen}
            triggerVariant="framed"
            triggerIcon={<MoreHorizontal size={16} aria-hidden />}
          >
            <MenuItem>
              <Button variant="danger" size="bare" onClick={() => void removeNote()}>
                Delete note
              </Button>
            </MenuItem>
          </Menu>
        )
      }
      banner={
        conflictNote && (
          <AlertBanner
            role="alert"
            actions={
              <>
                <Button variant="primary" size="bare" onClick={loadLatest}>
                  Load latest
                </Button>
                <Button variant="ghost" size="bare" onClick={keepMine}>
                  Keep mine (overwrite)
                </Button>
              </>
            }
          >
            This note changed on another device.
          </AlertBanner>
        )
      }
      tagPicker={
        availableTags.length > 0
          ? { tags: availableTags, selectedIds, onToggle: toggleTag, label: 'Attached tags' }
          : undefined
      }
    >
      <Textarea
        ref={textareaRef}
        variant="editor"
        aria-label="Note body"
        placeholder="Write a note… use #tags inline"
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          bodyRef.current = e.target.value;
          schedule();
        }}
        onBlur={() => void flush('final')}
      />
    </EditorChrome>
  );
}
