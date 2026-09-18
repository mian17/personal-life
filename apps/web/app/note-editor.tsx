'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Note } from '@life/shared';
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
  // A missing note means the create route: no autosave, only an explicit Save
  // creates, and Back discards. Existing notes keep the debounced autosave.
  const isNew = note === undefined;
  const initialLegacy = note?.tags.map((t) => t.name) ?? [];
  const [body, setBody] = useState(note?.body ?? '');
  const [retained, setRetained] = useState<string[]>(initialLegacy);
  const [status, setStatus] = useState<Status>('idle');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const dirtyRef = useRef(false);
  const creatingRef = useRef(false);
  const idRef = useRef<string | null>(note?.id ?? null);
  const bodyRef = useRef(note?.body ?? '');
  const retainedRef = useRef<string[]>(initialLegacy);
  // The body/tags the in-flight request is persisting, so a newer edit can win.
  const sentRef = useRef<{ body: string; tags: string[] } | null>(null);

  const save = useCallback(async () => {
    const id = idRef.current;
    // Create mode never autosaves; only an explicit Save POSTs.
    if (id === null) return;
    if (inFlightRef.current) {
      dirtyRef.current = true;
      return;
    }
    if (!dirtyRef.current) return;
    const nextBody = bodyRef.current;
    const nextTags = tagsFor(nextBody, retainedRef.current);
    if (!nextBody.trim()) {
      // Empty body on an existing note is rejected, so it stays dirty and unsaved.
      sentRef.current = null;
      dirtyRef.current = true;
      setStatus('error');
      return;
    }
    inFlightRef.current = true;
    dirtyRef.current = false;
    sentRef.current = { body: nextBody, tags: nextTags };
    setStatus('saving');
    try {
      // A route-handler fetch, unlike a Server Action, does not refresh the RSC
      // tree of the current route, so the editor is never remounted mid-edit.
      const res = await fetch(`/api/notes/${id}/flush`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: nextBody, tags: nextTags }),
      });
      if (!res.ok) {
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

  // Client-side navigation does not fire pagehide, so leaving an existing note
  // flushes the pending debounced save before navigating home.
  const leave = useCallback(async () => {
    await flush();
    router.push('/');
  }, [flush, router]);

  const goBack = useCallback(() => {
    // Back on a new note discards the draft without creating anything.
    if (isNew) {
      router.push('/');
      return;
    }
    void leave();
  }, [isNew, leave, router]);

  const saveNow = useCallback(async () => {
    if (!isNew) {
      await leave();
      return;
    }
    const nextBody = bodyRef.current;
    if (!nextBody.trim()) return;
    if (creatingRef.current) return;
    const nextTags = tagsFor(nextBody, retainedRef.current);
    creatingRef.current = true;
    setStatus('saving');
    try {
      const res = await fetch('/api/notes/flush', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: nextBody, tags: nextTags }),
      });
      if (!res.ok) {
        creatingRef.current = false;
        setStatus('error');
        return;
      }
      const created = (await res.json()) as { id: string };
      router.replace(`/notes/${created.id}`, { scroll: false });
    } catch {
      creatingRef.current = false;
      setStatus('error');
    }
  }, [isNew, leave, router]);

  // Keepalive is for existing notes only: a hidden or unloading new note must
  // not create anything, so its draft is simply dropped on the way out.
  const flushKeepalive = useCallback(() => {
    const id = idRef.current;
    if (id === null) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!dirtyRef.current) return;
    const nextBody = bodyRef.current;
    const nextTags = tagsFor(nextBody, retainedRef.current);
    const fail = () => {
      dirtyRef.current = true;
      setStatus('error');
    };
    if (!nextBody.trim()) {
      fail();
      return;
    }
    // Send even while a save is in flight: if an older PATCH lands after this
    // newer body, save() re-issues the latest body once it resolves.
    dirtyRef.current = false;
    void fetch(`/api/notes/${id}/flush`, {
      method: 'PATCH',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: nextBody, tags: nextTags }),
    })
      .then((res) => {
        if (!res.ok) fail();
      })
      .catch(fail);
  }, []);

  function schedule() {
    if (isNew) return;
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
      flushKeepalive();
    }
    function onVisibility() {
      if (document.visibilityState === 'hidden') flushKeepalive();
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
        <button type="button" className="editor-back" aria-label="Back" onClick={goBack}>
          {'\u2039'}
        </button>
        <span className="editor-status" role="status" aria-live="polite">
          {STATUS_TEXT[status]}
        </span>
        <button type="button" className="editor-save" onClick={() => void saveNow()}>
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
