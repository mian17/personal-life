'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Note } from '@life/shared';
import { createNoteAction, saveNote } from './actions';
import { dedupeTags, parseInlineTags } from './tags';

type Status = 'idle' | 'saving' | 'saved' | 'error';

const STATUS_TEXT: Record<Status, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  error: "Couldn't save",
};

function tagsFor(body: string, retained: readonly string[]): string[] {
  // Inline hashtags win casing; retained legacy tags union in.
  return dedupeTags([...parseInlineTags(body), ...retained]);
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag, i) => tag === b[i]);
}

export function NoteEditor({ note }: { note?: Note }) {
  const router = useRouter();
  const initialLegacy = note?.tags.map((t) => t.name) ?? [];
  const [body, setBody] = useState(note?.body ?? '');
  const [retained, setRetained] = useState<string[]>(initialLegacy);
  const [status, setStatus] = useState<Status>('idle');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const dirtyRef = useRef(false);
  // Once a create PATCHes an id, all later saves must update it — never POST again.
  const idRef = useRef<string | null>(note?.id ?? null);
  const bodyRef = useRef(note?.body ?? '');
  const retainedRef = useRef<string[]>(initialLegacy);
  // The body/tags the in-flight request is persisting, so a newer edit can win.
  const sentRef = useRef<{ body: string; tags: string[] } | null>(null);

  const save = useCallback(async () => {
    if (inFlightRef.current) {
      dirtyRef.current = true;
      return;
    }
    if (!dirtyRef.current) return;
    const nextBody = bodyRef.current;
    const nextTags = tagsFor(nextBody, retainedRef.current);
    if (idRef.current === null && !nextBody.trim()) {
      dirtyRef.current = false;
      return;
    }
    inFlightRef.current = true;
    dirtyRef.current = false;
    sentRef.current = { body: nextBody, tags: nextTags };
    setStatus('saving');
    try {
      const id = idRef.current;
      if (id === null) {
        const created = await createNoteAction(nextBody, nextTags);
        idRef.current = created.id;
        window.history.replaceState(null, '', `/notes/${created.id}`);
      } else if (!(await saveNote(id, nextBody, nextTags))) {
        // Empty body on an existing note is rejected, so it stays dirty and unsaved.
        sentRef.current = null;
        inFlightRef.current = false;
        dirtyRef.current = true;
        setStatus('error');
        return;
      }
      const sent = sentRef.current;
      sentRef.current = null;
      inFlightRef.current = false;
      const latestTags = tagsFor(bodyRef.current, retainedRef.current);
      const changed =
        sent === null || bodyRef.current !== sent.body || !sameTags(latestTags, sent.tags);
      if (dirtyRef.current || changed) {
        dirtyRef.current = true;
        void save();
      } else {
        setStatus('saved');
      }
    } catch {
      sentRef.current = null;
      inFlightRef.current = false;
      dirtyRef.current = true;
      setStatus('error');
    }
  }, []);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await save();
  }, [save]);

  // Server Actions do not survive navigation, so a pending edit is sent via a
  // keepalive fetch that the browser finishes after the page is gone.
  const flushKeepalive = useCallback((allowCreate: boolean) => {
    // Hidden-but-alive (tab switch, app background): a new note must not be
    // created here, because idRef and the URL stay null/'/notes/new'. Returning
    // to type would then POST again and duplicate it. Leave it dirty for the
    // normal debounced save. Only pagehide (allowCreate) may create.
    if (idRef.current === null && !allowCreate) return;
    const nextBody = bodyRef.current;
    const nextTags = tagsFor(nextBody, retainedRef.current);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const fail = () => {
      dirtyRef.current = true;
      setStatus('error');
    };
    // A rejected fetch or a non-2xx (e.g. the API rejecting an empty body) both
    // leave the edit dirty so it can be retried.
    const send = (url: string, method: 'POST' | 'PATCH') => {
      dirtyRef.current = false;
      void fetch(url, {
        method,
        keepalive: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: nextBody, tags: nextTags }),
      })
        .then((res) => {
          if (!res.ok) fail();
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
  }, []);

  function schedule() {
    dirtyRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void save();
    }, 400);
  }

  function removeLegacyTag(name: string) {
    const next = retainedRef.current.filter((t) => t.toLowerCase() !== name.toLowerCase());
    retainedRef.current = next;
    setRetained(next);
    schedule();
  }

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(0, 0);
    }
  }, []);

  useEffect(() => {
    function onPageHide() {
      // The page is actually leaving: a new note may be created here, and this
      // is the final act — there is no live page left to duplicate from.
      flushKeepalive(true);
    }
    function onVisibility() {
      // Hidden but alive: existing notes keepalive-PATCH, new notes stay dirty
      // for the normal debounced save (see flushKeepalive).
      if (document.visibilityState === 'hidden') flushKeepalive(false);
    }
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [flushKeepalive]);

  const inlineNames = new Set(parseInlineTags(body).map((t) => t.toLowerCase()));
  const legacyChips = retained.filter((name) => !inlineNames.has(name.toLowerCase()));

  return (
    <div className="editor-screen">
      <div className="editor-toolbar">
        <span className="editor-status" role="status" aria-live="polite">
          {STATUS_TEXT[status]}
        </span>
        <button
          type="button"
          className="editor-save"
          onClick={async () => {
            await flush();
            router.push('/');
          }}
        >
          Save
        </button>
      </div>
      <textarea
        ref={textareaRef}
        className="editor-body"
        aria-label="Note body"
        placeholder="Write a note… use #tags inline"
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          bodyRef.current = e.target.value;
          schedule();
        }}
        onBlur={() => void flush()}
      />
      {legacyChips.length > 0 && (
        <div className="editor-legacy-tags" role="group" aria-label="Saved tags">
          {legacyChips.map((name) => (
            <span key={name} className="tag-chip">
              {name}
              <button
                type="button"
                className="tag-chip-remove"
                aria-label={`Remove tag ${name}`}
                onClick={() => removeLegacyTag(name)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
