'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Note } from '@life/shared';
import { createNoteAction, deleteNoteAction, saveNote } from './actions';
import { dedupeTags, parseInlineTags } from './tags';

type Status = 'idle' | 'saving' | 'saved' | 'error';

const STATUS_TEXT: Record<Status, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  error: "Couldn't save",
};

export function NoteEditor({ note }: { note?: Note }) {
  const router = useRouter();
  const initialLegacy = note?.tags.map((t) => t.name) ?? [];
  const [body, setBody] = useState(note?.body ?? '');
  const [retained, setRetained] = useState<string[]>(initialLegacy);
  const [status, setStatus] = useState<Status>('idle');
  const [noteId, setNoteId] = useState<string | null>(note?.id ?? null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const dirtyRef = useRef(false);
  const deletingRef = useRef(false);
  // Once a create PATCHes an id, all later saves must update it — never POST again.
  const idRef = useRef<string | null>(note?.id ?? null);
  const bodyRef = useRef(note?.body ?? '');
  const retainedRef = useRef<string[]>(initialLegacy);

  const save = useCallback(async () => {
    if (deletingRef.current) return;
    if (inFlightRef.current) {
      dirtyRef.current = true;
      return;
    }
    if (!dirtyRef.current) return;
    const nextBody = bodyRef.current;
    if (idRef.current === null && !nextBody.trim()) {
      dirtyRef.current = false;
      return;
    }
    // Tags are derived here, on save only: inline hashtags win casing, retained legacy tags union in.
    const nextTags = dedupeTags([...parseInlineTags(nextBody), ...retainedRef.current]);
    inFlightRef.current = true;
    dirtyRef.current = false;
    setStatus('saving');
    try {
      const id = idRef.current;
      if (id === null) {
        const created = await createNoteAction(nextBody, nextTags);
        idRef.current = created.id;
        setNoteId(created.id);
        window.history.replaceState(null, '', `/notes/${created.id}`);
      } else {
        await saveNote(id, nextBody, nextTags);
      }
      inFlightRef.current = false;
      if (deletingRef.current) return;
      if (dirtyRef.current) {
        void save();
      } else {
        setStatus('saved');
      }
    } catch {
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

  const remove = useCallback(async () => {
    const id = idRef.current;
    if (id === null) return;
    deletingRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    dirtyRef.current = false;
    try {
      await deleteNoteAction(id);
    } catch {
      deletingRef.current = false;
      setStatus('error');
      return;
    }
    router.push('/');
  }, [router]);

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
    function onVisibility() {
      if (document.visibilityState === 'hidden') void flush();
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [flush]);

  const inlineNames = new Set(parseInlineTags(body).map((t) => t.toLowerCase()));
  const legacyChips = retained.filter((name) => !inlineNames.has(name.toLowerCase()));

  return (
    <div className="editor-screen">
      <div className="editor-toolbar">
        <button
          type="button"
          className="editor-done"
          onClick={async () => {
            await flush();
            router.push('/');
          }}
        >
          Done
        </button>
        <span className="editor-status" role="status" aria-live="polite">
          {STATUS_TEXT[status]}
        </span>
        {noteId !== null && (
          <button type="button" className="editor-delete" onClick={() => void remove()}>
            Delete
          </button>
        )}
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
        <div className="editor-legacy-tags" aria-label="Saved tags">
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
