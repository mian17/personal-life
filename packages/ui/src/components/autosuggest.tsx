'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { cx } from '../lib/cx';
import { Input } from './input';

/** One candidate the caller offers. `meta` renders as the quiet trailing text. */
export interface AutosuggestOption {
  id: string;
  label: string;
  meta?: string;
}

export interface AutosuggestProps {
  /** The caller's already-filtered, best-first candidates; `maxVisible` show at a time. */
  options: readonly AutosuggestOption[];
  /** Reported once the text is at least `minChars` (trimmed), after `debounceMs`. `''` means "do not search". */
  onQueryChange: (query: string) => void;
  onSelect: (option: AutosuggestOption) => void;
  /** The field's accessible name (`aria-label`). */
  label: string;
  placeholder?: string;
  /** Shown in the popup when the query is long enough but no option matches. */
  emptyLabel?: string;
  /** `true` (default) clears the field on a pick; `false` keeps the query and the popup (multi-add). */
  clearOnSelect?: boolean;
  /** Shortest trimmed query that searches; below it `''` is reported and the popup stays closed. */
  minChars?: number;
  /** Report delay in ms. `0` (default) reports synchronously on every keystroke. */
  debounceMs?: number;
  /** Options visible in the popup at once; the rest scroll. */
  maxVisible?: number;
}

/**
 * A combobox: an `Input` that owns its own text and reports the query to a
 * caller which supplies the already-filtered options. The popup is a native
 * `popover`, so the platform lifts it into the top layer — no portal, no JS
 * positioning — and it escapes an ancestor's `overflow: hidden`.
 */
export function Autosuggest({
  options,
  onQueryChange,
  onSelect,
  label,
  placeholder,
  emptyLabel,
  clearOnSelect = true,
  minChars = 3,
  debounceMs = 0,
  maxVisible = 8,
}: Readonly<AutosuggestProps>) {
  const [text, setText] = useState('');
  const [highlight, setHighlight] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onQueryChangeRef = useRef(onQueryChange);
  onQueryChangeRef.current = onQueryChange;

  // The anchor name is per instance (`anchor-name` is a page-global ident) and
  // must be a CSS ident: `useId` gives back punctuation that is not.
  const anchorName = `--ui-autosuggest-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const popupId = `${anchorName}-popup`;

  const trimmed = text.trim();
  const longEnough = trimmed.length >= minChars;
  const canOpen = longEnough && (options.length > 0 || emptyLabel != null);
  const open = canOpen && !dismissed;

  useEffect(() => {
    if (!open) return;
    const popup = popupRef.current;
    if (!popup) return;
    popup.showPopover();
    return () => popup.hidePopover();
  }, [open]);

  // `aria-activedescendant` announces the highlighted row but the browser never
  // scrolls it into view. With more than `maxVisible` matches the highlight
  // would walk off the visible slice. `block: 'nearest'` scrolls the popup only.
  useEffect(() => {
    if (!open || highlight < 0) return;
    // jsdom has no layout and no `scrollIntoView`; the browser is the judge of placement.
    popupRef.current?.children[highlight]?.scrollIntoView?.({ block: 'nearest' });
  }, [open, highlight]);

  // Light dismiss: `popover="manual"` gets none from the platform, and a list
  // left floating over the controls below the field is the one thing a picker
  // must not do. The field itself is spared so clicking it keeps the list up.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popupRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(`[aria-controls="${popupId}"]`)) return;
      setDismissed(true);
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, popupId]);

  useEffect(() => () => cancelReport(), []);

  /** Drop a pending debounced report (a keystroke, a clear, and unmount all do). */
  function cancelReport() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  /** Hand a trimmed query to the caller: `''` below `minChars`, after `debounceMs` otherwise. */
  function report(query: string) {
    cancelReport();
    setHighlight(-1);
    if (query.length < minChars) {
      onQueryChangeRef.current('');
      return;
    }
    if (debounceMs <= 0) {
      onQueryChangeRef.current(query);
      return;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onQueryChangeRef.current(query);
    }, debounceMs);
  }

  function change(next: string) {
    setText(next);
    setDismissed(false);
    report(next.trim());
  }

  function clear() {
    setText('');
    setDismissed(false);
    report('');
  }

  function select(option: AutosuggestOption) {
    onSelect(option);
    if (clearOnSelect) clear();
    else setHighlight(-1);
  }

  /** Alt+ArrowDown opens the popup without taking a highlight. */
  function openWithoutHighlight(event: KeyboardEvent<HTMLInputElement>) {
    if (!longEnough) return;
    setDismissed(false);
    event.preventDefault();
  }

  /** ArrowDown opens the popup on its first row, or walks an open one down. */
  function moveDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (!canOpen) return;
      setDismissed(false);
      setHighlight(options.length > 0 ? 0 : -1);
    } else {
      setHighlight((index) => (index < options.length - 1 ? index + 1 : index));
    }
    event.preventDefault();
  }

  function moveUp(event: KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    setHighlight((index) => (index > 0 ? index - 1 : 0));
    event.preventDefault();
  }

  function moveToEdge(key: string, event: KeyboardEvent<HTMLInputElement>) {
    if (!open || options.length === 0) return;
    setHighlight(key === 'Home' ? 0 : options.length - 1);
    event.preventDefault();
  }

  function pickHighlighted(event: KeyboardEvent<HTMLInputElement>) {
    if (!open || highlight < 0 || highlight >= options.length) return;
    select(options[highlight]);
    event.preventDefault();
  }

  function escapeOrClear(event: KeyboardEvent<HTMLInputElement>) {
    event.preventDefault();
    // First Escape closes the popup, the next one (already closed) clears the field.
    if (open) setDismissed(true);
    else clear();
  }

  function leaveField() {
    if (open && highlight >= 0 && highlight < options.length) select(options[highlight]);
    setDismissed(true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const { key } = event;
    if (key === 'ArrowDown' && event.altKey) {
      openWithoutHighlight(event);
      return;
    }
    switch (key) {
      case 'ArrowDown':
        moveDown(event);
        return;
      case 'ArrowUp':
        moveUp(event);
        return;
      case 'Home':
      case 'End':
        moveToEdge(key, event);
        return;
      case 'Enter':
        pickHighlighted(event);
        return;
      case 'Escape':
        escapeOrClear(event);
        return;
      case 'Tab':
        leaveField();
        return;
      default:
        return;
    }
  }

  return (
    <>
      <Input
        type="text"
        style={{ anchorName }}
        placeholder={placeholder}
        aria-label={label}
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={popupId}
        aria-activedescendant={open && highlight >= 0 ? `${popupId}-option-${highlight}` : undefined}
        value={text}
        onChange={(event) => change(event.target.value)}
        onKeyDown={handleKeyDown}
        // A dismissed list comes back when the field is entered again: a press
        // for a field that kept focus (Escape), a focus for one that did not.
        onPointerDown={() => setDismissed(false)}
        onFocus={() => setDismissed(false)}
      />
      {open && (
        <div
          ref={popupRef}
          id={popupId}
          popover="manual"
          role={options.length > 0 ? 'listbox' : undefined}
          className="ui-autosuggest__popup"
          style={{ positionAnchor: anchorName, '--ui-autosuggest-rows': maxVisible } as CSSProperties}
        >
          {options.length === 0 ? (
            <output className="ui-autosuggest__empty">{emptyLabel}</output>
          ) : (
            options.map((option, index) => (
              <div
                key={option.id}
                id={`${popupId}-option-${index}`}
                role="option"
                aria-selected={index === highlight}
                // An option is a control, so it must be focusable — but never a tab
                // stop: the field keeps focus and reaches rows through
                // `aria-activedescendant` (WAI-ARIA APG combobox pattern).
                tabIndex={-1}
                className={cx(
                  'ui-autosuggest__option',
                  index === highlight && 'ui-autosuggest__option--active',
                )}
                // Without this the field blurs, the popup unmounts and the click is lost.
                onMouseDown={(event) => event.preventDefault()}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => select(option)}
                // The field owns keyboard interaction (aria-activedescendant), but a row
                // that responds to a click must also respond to Enter/Space.
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  select(option);
                }}
              >
                <span className="ui-autosuggest__label">{option.label}</span>
                {option.meta != null && <span className="ui-autosuggest__meta">{option.meta}</span>}
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
}
