// Composed registry `combobox` recipe (`popover` + `command`), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentPropsWithRef, CSSProperties, KeyboardEvent } from 'react';
import { useCommandState } from 'cmdk';
import { Command, CommandEmpty, CommandItem, CommandList } from './command';
import { Input } from './input';
import { Popover, PopoverAnchor, PopoverContent } from './popover';
import { SearchField } from './search-field';

/**
 * A value no row carries. `cmdk` selects the first row whenever its value is empty, so a list
 * would open with row 1 already chosen and a bare Enter would pick something the user never
 * walked to. The root's value starts here instead: truthy, matching nothing, selecting nothing.
 */
const NO_ROW = '\u0000';

/** The one piece of row state the root owns: which option a pick reports, and how to move it. */
interface Highlight {
  highlightedValue: string;
  moveHighlightTo: (value: string) => void;
}

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
  /**
   * The shell the field wears: `'input'` (default) keeps today's field, `'search'` the `.search`
   * shell. Cosmetic only — the gate, the debounced report, the popup and the keyboard walk are
   * the same in both.
   */
  field?: 'input' | 'search';
}

/**
 * `SearchField` always reports its own debounced text. In the search shell the field belongs to
 * this component (`inputProps` carries the value and the keys), so that report has nothing of
 * its own to say — and never fires, because the shell's own text never moves.
 */
function noQueryReport() {
  // Intentionally silent: the search shell's text is this component's, so there is nothing to report.
}

/**
 * A combobox from the registry recipe: an `Input` inside a `Popover`, over a `Command` root whose
 * list holds the candidates.
 *
 * `cmdk` owns the listbox, the highlight `aria-activedescendant` names, and the keyboard walk that
 * moves it — the field sits inside the root so its keys reach that walk. This file owns the
 * `minChars` gate, the debounced report, the pick and the dismissal. The caller filters
 * (`shouldFilter` is off), so the options arrive already matched and best-first.
 *
 * Deviation from the recipe: it lets `cmdk` auto-highlight the first row, so a list opens with a
 * row already chosen and a bare Enter picks something the user never walked to. Here the root's
 * `value` rests at `NO_ROW` until an explicit walk, which is how the hand-rolled list behaved.
 */
export function Autosuggest(props: Readonly<AutosuggestProps>) {
  // Held here because the root owns the selection, and the field below reads it back through
  // `useCommandState`. `''` never reaches the root: it would mean "preselect row 1" to `cmdk`.
  const [highlightedValue, setHighlightedValue] = useState<string>(NO_ROW);
  const moveHighlightTo = useCallback(
    (next: string) => setHighlightedValue(next === '' ? NO_ROW : next),
    [],
  );
  return (
    <Command shouldFilter={false} value={highlightedValue} onValueChange={moveHighlightTo}>
      <ComboboxField {...props} highlightedValue={highlightedValue} moveHighlightTo={moveHighlightTo} />
    </Command>
  );
}

/** The field and its popup, reading the highlight out of the `Command` root that owns it. */
function ComboboxField({
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
  field = 'input',
  highlightedValue,
  moveHighlightTo,
}: Readonly<AutosuggestProps & Highlight>) {
  const [text, setText] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const [listboxId, setListboxId] = useState('');
  const fieldRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onQueryChangeRef = useRef(onQueryChange);
  onQueryChangeRef.current = onQueryChange;
  const query = text.trim();
  const longEnough = query.length >= minChars;
  const hasPopupContent = options.length > 0 || emptyLabel != null;
  const open = longEnough && hasPopupContent && !dismissed;
  // `cmdk` mints the row element ids and marks the selected row, but it hands neither the ids nor
  // the marked element out. Both are re-read here after each commit that can change them: the
  // count moves when rows mount, the selection moves when the walk does.
  const markedValue = useCommandState((state) => state.value);
  const renderedRows = useCommandState((state) => state.filtered.count);
  const [highlightedRowId, setHighlightedRowId] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!open || highlightedValue === NO_ROW) {
      setHighlightedRowId(undefined);
      return;
    }
    setHighlightedRowId(listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.id);
  }, [open, highlightedValue, markedValue, renderedRows, options]);

  // `cmdk` mints the listbox id, so the field's `aria-controls` copies it as the list mounts.
  const mountList = useCallback((list: HTMLDivElement | null) => {
    listRef.current = list;
    setListboxId(list?.id ?? '');
  }, []);

  // The field keeps focus, so the platform dismisses nothing: a press outside both the field and
  // the list drops the list, and the text stays put.
  useEffect(() => {
    if (!open) return;
    function dismissOnOutsidePress(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (fieldRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setDismissed(true);
    }
    document.addEventListener('pointerdown', dismissOnOutsidePress, true);
    return () => document.removeEventListener('pointerdown', dismissOnOutsidePress, true);
  }, [open]);

  useEffect(() => () => cancelReport(), []);

  /** Drop a pending debounced report (a keystroke, a clear, and unmount all do). */
  function cancelReport() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  /** Hand a trimmed query to the caller: `''` below `minChars`, after `debounceMs` otherwise. */
  function report(nextQuery: string) {
    cancelReport();
    // New text means new rows: the old highlight named one that may be gone, and the list opens
    // unchosen rather than on whatever landed first.
    moveHighlightTo(NO_ROW);
    if (nextQuery.length < minChars) {
      onQueryChangeRef.current('');
      return;
    }
    if (debounceMs <= 0) {
      onQueryChangeRef.current(nextQuery);
      return;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onQueryChangeRef.current(nextQuery);
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

  /** `cmdk` reports a pick by value (the option id), so the row is looked up again here. */
  function selectValue(value: string) {
    const option = options.find((candidate) => candidate.id === value);
    if (option == null) return;
    onSelect(option);
    if (clearOnSelect) clear();
    else moveHighlightTo(NO_ROW);
  }

  /** Escape closes the list and keeps the text; the next Escape, finding it closed, clears. */
  function closeOrClear(event: KeyboardEvent<HTMLInputElement>) {
    event.preventDefault();
    if (open) setDismissed(true);
    else clear();
  }

  /** ArrowDown reopens a list that a press or an Escape closed; an open list is `cmdk`'s to walk. */
  function reopenOnArrowDown(event: KeyboardEvent<HTMLInputElement>) {
    if (open || !hasPopupContent) return;
    event.preventDefault();
    setDismissed(false);
    // The reopen takes the walk's first step, exactly as ArrowDown on a closed list always did.
    moveHighlightTo(options[0]?.id ?? NO_ROW);
  }

  /** Alt+ArrowDown opens the list the way a first ArrowDown does, minus the step onto a row. */
  function reopenWithoutHighlight(event: KeyboardEvent<HTMLInputElement>) {
    if (!longEnough) return;
    event.preventDefault();
    if (open) return;
    setDismissed(false);
    moveHighlightTo(NO_ROW);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'Escape':
        closeOrClear(event);
        return;
      case 'Tab':
        // Tab accepts the row the user walked to, as the hand-rolled list did, and moves on.
        if (open) selectValue(highlightedValue);
        return;
      case 'ArrowDown':
        if (event.altKey) reopenWithoutHighlight(event);
        else reopenOnArrowDown(event);
        return;
      default:
        // ArrowUp, Home, End and Enter are `cmdk`'s: it owns the walk over the rendered rows.
        return;
    }
  }

  // One prop object feeds whichever shell is worn, so the two cannot drift apart.
  const fieldProps: ComponentPropsWithRef<'input'> = {
    ref: fieldRef,
    // Both shells take a plain text field: a `type="search"` one adds the platform's clear
    // control, an interaction this combobox does not have (it clears on Escape or a pick).
    type: 'text',
    placeholder,
    'aria-label': label,
    role: 'combobox',
    autoComplete: 'off',
    'aria-autocomplete': 'list',
    'aria-expanded': open,
    'aria-controls': open ? listboxId : undefined,
    'aria-activedescendant': open ? highlightedRowId : undefined,
    value: text,
    onChange: (event) => change(event.target.value),
    onKeyDown: handleKeyDown,
    // A dismissed list comes back when the field is entered again: a press for a field that
    // kept focus (Escape), a focus for one that did not.
    onPointerDown: () => setDismissed(false),
    onFocus: () => setDismissed(false),
  };

  return (
    <Popover open={open} onOpenChange={(next) => setDismissed(!next)}>
      {field === 'search' ? (
        // The shell is `SearchField`'s; the field inside it is this component's, so the value,
        // the keys and the ARIA travel through `inputProps`.
        <PopoverAnchor>
          <SearchField
            label={label}
            placeholder={placeholder ?? ''}
            onQueryChange={noQueryReport}
            inputProps={fieldProps}
          />
        </PopoverAnchor>
      ) : (
        <PopoverAnchor asChild>
          <Input {...fieldProps} />
        </PopoverAnchor>
      )}
      {open && (
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] p-0"
          // The field owns focus and the outside press; the panel takes neither.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <CommandList ref={mountList} style={{ '--autosuggest-rows': maxVisible } as CSSProperties}>
            {options.map((option) => (
              <CommandItem
                key={option.id}
                value={option.id}
                className="min-h-[var(--tap)]"
                onSelect={selectValue}
                // Without this the row press blurs the field and the click is lost.
                onPointerDown={(event) => event.preventDefault()}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.meta != null && <span className="shrink-0 text-ink-2">{option.meta}</span>}
              </CommandItem>
            ))}
            <CommandEmpty>{emptyLabel}</CommandEmpty>
          </CommandList>
        </PopoverContent>
      )}
    </Popover>
  );
}
