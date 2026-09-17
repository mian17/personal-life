'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Note } from '@life/shared';
import { saveNote } from './actions';

type Status = 'idle' | 'saving' | 'saved' | 'error';

const STATUS_TEXT: Record<Status, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  error: "Couldn't save",
};

function parseTags(value: string): string[] {
  return value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

export function NoteEditor({ note }: { note: Note }) {
  const router = useRouter();
  const initialTags = note.tags.map((t) => t.name).join(', ');
  const [body, setBody] = useState(note.body);
  const [tags, setTags] = useState(initialTags);
  const [status, setStatus] = useState<Status>('idle');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const dirtyRef = useRef(false);
  const latestRef = useRef({ body: note.body, tags: initialTags });

  const save = useCallback(async () => {
    if (inFlightRef.current) {
      dirtyRef.current = true;
      return;
    }
    if (!dirtyRef.current) return;
    inFlightRef.current = true;
    dirtyRef.current = false;
    setStatus('saving');
    try {
      await saveNote(note.id, latestRef.current.body, parseTags(latestRef.current.tags));
      inFlightRef.current = false;
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
  }, [note.id]);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await save();
  }, [save]);

  function schedule() {
    dirtyRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void save();
    }, 400);
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
      </div>
      <textarea
        ref={textareaRef}
        className="editor-body"
        aria-label="Note body"
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          latestRef.current.body = e.target.value;
          schedule();
        }}
        onBlur={() => void flush()}
      />
      <input
        className="editor-tags"
        aria-label="Tags, comma separated"
        placeholder="tags, comma separated"
        value={tags}
        onChange={(e) => {
          setTags(e.target.value);
          latestRef.current.tags = e.target.value;
          schedule();
        }}
        onBlur={() => void flush()}
      />
    </div>
  );
}
