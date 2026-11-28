import { cx } from '../lib/cx';

export interface ChoiceChipOption {
  /** The value the group reports — the stored repeat, as a string. */
  value: string;
  /** The visible mark — "∞", "1" … — not necessarily the value. */
  label: string;
  /** The accessible name, when the visible mark is not a word. */
  ariaLabel?: string;
}

export interface ChoiceChipsProps {
  /** The group's accessible name. Never rendered: the visible caption belongs to `Section`. */
  label: string;
  options: ChoiceChipOption[];
  /** The one pressed option. No match leaves the run unpressed rather than inventing a choice. */
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

/**
 * The `fieldset` reset: the UA draws a groove border, a padding and an inline margin on it, and
 * `base.css` does not reset either. `min-w-0` keeps a flex item from refusing to shrink.
 */
const groupStyles = 'ui-choice-chips m-0 min-w-0 border-0 p-0 flex flex-wrap gap-[var(--s2)]';

/**
 * The chip: `Pill`'s language — the pill radius, the chip size, semibold, the `--tap` floor —
 * drawn by this primitive instead, so `aria-pressed` has exactly one source.
 */
const chipStyles = cx(
  'ui-choice-chip inline-flex items-center justify-center',
  'min-w-[var(--tap)] min-h-[var(--tap)] px-[var(--s3)] border rounded-[var(--r-pill)]',
  'text-[length:var(--fs-chip)] [font-weight:var(--fw-semibold)] [font-family:inherit]',
  'cursor-pointer outline-none motion-safe:transition-colors',
  'focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)] focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-focus',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

/**
 * Two complete faces, selected one at a time: a pressed chip never carries the unpressed fill, so
 * the accent's three declarations always win as a group. The pressed face has no `active:` wash —
 * a pressed chip stays the accent under the finger.
 */
const chipFaceStyles: Record<'unpressed' | 'pressed', string> = {
  unpressed: 'border-line bg-surface-sunken text-ink-2 active:bg-press',
  pressed: 'border-max bg-max text-on-max',
};

/**
 * A pressed single-select run. `aria-pressed` is the only state: a `radiogroup` would announce
 * "1 of 7" and demand roving focus, at the price of the button semantics the design uses, and
 * seven stops is a short enough run to Tab across.
 *
 * The group's name is `aria-label` because the visible caption belongs to `Section`: the run is a
 * set, and the seven names each begin "Repeat:". The container is a `<fieldset>` for the same
 * reason — it carries the `group` role natively, so the name needs no `role` attribute — and it
 * carries no `<legend>`, which would repeat the caption `Section` already renders.
 */
export function ChoiceChips({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: Readonly<ChoiceChipsProps>) {
  return (
    <fieldset aria-label={label} className={groupStyles}>
      {options.map((option) => {
        const pressed = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-label={option.ariaLabel}
            aria-pressed={pressed}
            className={cx(chipStyles, chipFaceStyles[pressed ? 'pressed' : 'unpressed'])}
            disabled={disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </fieldset>
  );
}
