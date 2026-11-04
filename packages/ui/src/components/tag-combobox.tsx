// Composed registry `combobox` recipe (`popover` + `command`), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
'use client';

import { useCommandState } from 'cmdk';
import { Check, ChevronDown } from 'lucide-react';
import { useCallback, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { cx } from '../lib/cx';
import { Command, CommandEmpty, CommandItem, CommandList } from './command';
import { Input } from './input';
import { Pill } from './pill';
import { Popover, PopoverAnchor, PopoverContent } from './popover';

/**
 * A value no row carries. `cmdk` selects the first row whenever its value is empty, so the list
 * would open with a row already chosen and a bare Enter would toggle a tag the user never walked
 * to. The root's value rests here instead: truthy, matching nothing, selecting nothing.
 */
const NO_ROW = '\u0000';

/** Shown on the closed field when the caller has no tags to offer at all. */
const NO_TAGS = 'No tags yet';

/** The popup's search field: its accessible name, also its placeholder. */
const SEARCH_LABEL = 'Search tags';

/** One tag the user may attach. */
export interface TagOption {
  id: number;
  name: string;
}

export interface TagComboboxProps {
  /** Every tag the user may attach. */
  tags: readonly TagOption[];
  /** Currently attached ids. */
  selectedIds: readonly number[];
  /** Attach/detach one tag; the app owns the state. */
  onToggle: (id: number) => void;
  /** Caption line and accessible name, e.g. "Attached tags" / "Tags". */
  label?: string;
  /** The field's text when nothing is attached. */
  placeholder?: string;
  /** Closes the field and the popup. */
  disabled?: boolean;
  className?: string;
}

/**
 * §8's field caption: the section-label size, weight and tracking, upper case, second ink tier —
 * a block on its own line, one `--s2` above the field, which is the `.field__label` relationship
 * the design language draws. The `ui-field-label` hook is shared with every other labelled row.
 */
const labelStyles = cx(
  'ui-tag-combobox__label ui-field-label block mb-[var(--s2)]',
  'uppercase text-ink-2 text-[length:var(--fs-section-label)] font-[var(--fw-section-label)]',
  'tracking-[var(--tracking-section-label)]',
);

/**
 * The `Input` field shell worn by a button, so a trigger that opens a panel and a text field read
 * as one control: the strong hairline, the field radius, the field rhythm and the focus ring.
 */
const fieldStyles = cx(
  'ui-tag-combobox__field flex w-full min-w-0 flex-wrap items-center gap-[var(--s2)] text-left',
  'min-h-[var(--tap)] px-[var(--s3)] py-[var(--s2)]',
  'rounded-[var(--r-md)] border border-line-strong bg-surface',
  'text-[length:var(--fs-button)] text-ink',
  'focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)] focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-focus',
  'disabled:cursor-not-allowed disabled:text-ink-3 disabled:opacity-50',
);

/** The attached chips wrap onto further rows inside the field, one `--s2` apart. */
const chipsStyles = 'ui-tag-combobox__chips flex flex-wrap items-center gap-[var(--s2)]';

/** The chevron trails whatever the field holds, in the icon tier. */
const chevronStyles = 'ml-auto shrink-0 text-ink-3';

/** The search strip at the panel's top: the field sits at the popup's own `--s2` block inset. */
const searchStyles = 'p-[var(--s2)]';

/**
 * The check mark's box: one icon wide, held open on every row so a name does not shift sideways
 * as the selection moves. The glyph inherits the row's ink, so it reads on the accent fill too.
 */
const checkStyles = 'flex w-[var(--s4)] shrink-0 justify-center';

/**
 * A multi-select tag field from the registry `combobox` recipe: a caption, a field that holds the
 * attached tags as chips, and a `Popover` panel over a `Command` list.
 *
 * `cmdk` owns the listbox, the keyboard walk over the rendered rows and the `aria-activedescendant`
 * that names the walked row; this file owns the chips, the local filter, the toggle and the
 * dismissal. The caller filters (`shouldFilter` is off), so the rows arrive already matched.
 *
 * Deviation from the recipe: it closes on a pick, because the registry's combobox picks one value.
 * Here a toggle never dismisses — attaching several tags is the point — and the list opens
 * unchosen (see `NO_ROW`), so a bare Enter cannot toggle a row the user never walked to.
 */
export function TagCombobox({
  tags,
  selectedIds,
  onToggle,
  label = 'Tags',
  placeholder = 'Select tags…',
  disabled = false,
  className,
}: Readonly<TagComboboxProps>) {
  // The root owns the walk and the field reads it back, so the highlight lives here.
  const [highlightedValue, setHighlightedValue] = useState(NO_ROW);
  const moveHighlightTo = useCallback(
    (next: string) => setHighlightedValue(next === '' ? NO_ROW : next),
    [],
  );

  return (
    <Command
      shouldFilter={false}
      value={highlightedValue}
      onValueChange={moveHighlightTo}
      className={cx('ui-tag-combobox', className)}
    >
      <TagComboboxControl
        tags={tags}
        selectedIds={selectedIds}
        onToggle={onToggle}
        label={label}
        placeholder={placeholder}
        disabled={disabled}
        highlightedValue={highlightedValue}
        moveHighlightTo={moveHighlightTo}
      />
    </Command>
  );
}

interface TagComboboxControlProps extends Omit<TagComboboxProps, 'className'> {
  /** The row `cmdk` currently walks, or `NO_ROW`. */
  highlightedValue: string;
  moveHighlightTo: (value: string) => void;
}

/** The caption, the field and its popup, inside the `Command` root that owns the walk. */
function TagComboboxControl({
  tags,
  selectedIds,
  onToggle,
  label = 'Tags',
  placeholder = 'Select tags…',
  disabled = false,
  highlightedValue,
  moveHighlightTo,
}: Readonly<TagComboboxControlProps>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [listboxId, setListboxId] = useState('');
  const captionId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Whether the next close hands focus back to the field: a Tab has already moved it onward.
  const returnFocusOnClose = useRef(true);

  const hasTags = tags.length > 0;
  const inert = disabled || !hasTags;
  const attached = tags.filter((tag) => selectedIds.includes(tag.id));
  const searched = query.trim().toLowerCase();
  const matched = tags.filter((tag) => tag.name.toLowerCase().includes(searched));
  // `cmdk` marks the walked row itself; the field repeats the marked row's id, as it would for
  // any other listbox whose keyboard focus stays in the search field.
  const activeRowId = useCommandState((state) => state.selectedItemId);

  // `cmdk` mints the listbox id, so the field's `aria-controls` copies it as the list mounts.
  const mountList = useCallback((list: HTMLDivElement | null) => {
    setListboxId(list?.id ?? '');
  }, []);

  function changeOpen(next: boolean) {
    if (next) {
      // Every open starts unchosen and unfiltered: the previous search must not narrow this one.
      moveHighlightTo(NO_ROW);
      setQuery('');
      returnFocusOnClose.current = true;
    }
    setOpen(next);
  }

  /** The field's own keys. `cmdk` owns the walk and Enter; Space toggles only on a walked row. */
  function handleFieldKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Tab') {
      // The panel is a focus scope that loops Tab back to its own first control. Focus leaving is
      // what dismisses the panel, so the scope is told to leave this Tab to the browser.
      event.stopPropagation();
      returnFocusOnClose.current = false;
      return;
    }
    if (event.key !== ' ' || highlightedValue === NO_ROW) return;
    // Off a walked row Space is a character — searching "home repair" must work — so only a
    // walked row is toggled, exactly as Enter does.
    event.preventDefault();
    onToggle(Number(highlightedValue));
  }

  /** ArrowDown opens the panel the way Tab then a press would; the panel takes the focus. */
  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowDown' || open) return;
    event.preventDefault();
    changeOpen(true);
  }

  function filter(next: string) {
    setQuery(next);
    // New rows mean the walked row may be gone: the list starts unchosen again.
    moveHighlightTo(NO_ROW);
  }

  return (
    <>
      <span id={captionId} className={labelStyles}>
        {label}
      </span>
      <Popover open={open} onOpenChange={changeOpen}>
        <PopoverAnchor asChild>
          <button
            ref={triggerRef}
            type="button"
            className={fieldStyles}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listboxId : undefined}
            aria-labelledby={captionId}
            disabled={inert}
            onClick={() => changeOpen(!open)}
            onKeyDown={handleTriggerKeyDown}
          >
            {attached.length > 0 ? (
              <span className={chipsStyles}>
                {attached.map((tag) => (
                  <Pill key={tag.id} as="span" size="chip">
                    {tag.name}
                  </Pill>
                ))}
              </span>
            ) : (
              <span className="text-ink-3">{hasTags ? placeholder : NO_TAGS}</span>
            )}
            <ChevronDown size={16} aria-hidden className={chevronStyles} />
          </button>
        </PopoverAnchor>
        {open && (
          <PopoverContent
            align="start"
            className="w-[var(--radix-popover-trigger-width)] p-0"
            // The field is the anchor, so Radix cannot recognise a press on it as its own: without
            // this the trigger would close the panel and the click would reopen it in one gesture.
            onInteractOutside={(event) => {
              if (event.target instanceof Node && triggerRef.current?.contains(event.target)) {
                event.preventDefault();
              }
            }}
            // Radix would restore focus to a trigger it never registered; the field is the anchor,
            // so the close hands focus back here — except after a Tab, which moves it onward.
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (returnFocusOnClose.current) triggerRef.current?.focus();
            }}
          >
            <div className={searchStyles}>
              <Input
                type="text"
                autoComplete="off"
                placeholder={SEARCH_LABEL}
                aria-label={SEARCH_LABEL}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={open}
                aria-controls={listboxId}
                aria-activedescendant={activeRowId}
                value={query}
                onChange={(event) => filter(event.target.value)}
                onKeyDown={handleFieldKeyDown}
              />
            </div>
            <CommandList ref={mountList} label={label} aria-multiselectable="true">
              {matched.map((tag) => {
                const chosen = selectedIds.includes(tag.id);
                return (
                  <CommandItem
                    key={tag.id}
                    value={String(tag.id)}
                    aria-checked={chosen}
                    className="min-h-[var(--tap)]"
                    onSelect={() => onToggle(tag.id)}
                    // Without this the row press blurs the search field and the click is lost.
                    onPointerDown={(event) => event.preventDefault()}
                  >
                    <span className={checkStyles}>{chosen && <Check size={16} aria-hidden />}</span>
                    <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                  </CommandItem>
                );
              })}
              <CommandEmpty>No tags match.</CommandEmpty>
            </CommandList>
          </PopoverContent>
        )}
      </Popover>
    </>
  );
}
