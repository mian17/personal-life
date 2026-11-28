import { cx } from '../lib/cx';

export interface NumberFieldProps {
  /** The control's accessible name; the visible suffix is not a name. */
  label: string;
  /** The value, or `null` while the field is empty — an empty field is a state, not a zero. */
  value: number | null;
  /** Reports `null` when the field is emptied, so a typo can never be read as a value. */
  onChange: (next: number | null) => void;
  /** The unit drawn beside the control: "h", "m", "s". Already spoken inside `label`. */
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  /** A field the caller has refused: emptied, or outside its bounds. */
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
}

const DEFAULT_STEP = 1;

const rowStyles = 'ui-number-field flex flex-1 items-center gap-[var(--s1)] min-w-0';

/**
 * The field: the sunken well on the hairline, centred digits at the row-title size, the UA's
 * spinner hardware removed — the ± pair around it is the only way to step.
 */
const fieldStyles = cx(
  'ui-number-field__input block w-full min-w-0 min-h-[var(--tap)] px-[var(--s2)]',
  'rounded-[var(--r-sm)] border bg-surface-sunken',
  'text-ink text-[length:var(--fs-row-title)] text-center [font-family:inherit]',
  'outline-none [appearance:textfield] motion-safe:transition-colors',
  '[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
  'focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)] focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-focus',
  'disabled:cursor-not-allowed disabled:text-ink-3',
);

/** One border colour at a time: the hairline by default, the refusal's ink when the caller says so. */
const borderStyles: Record<'default' | 'invalid', string> = {
  default: 'border-line',
  invalid: 'border-danger',
};

const unitStyles = 'ui-number-field__unit text-ink-3 text-[length:var(--fs-meta)]';

/**
 * Reads a typed value, or `null` when there is nothing usable in it. The field reports what was
 * typed and never invents a number for an empty box — coercing an empty or unparsable entry to
 * zero is what turns a typo into a real offset.
 */
function parsedValue(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A bounded integer with its unit beside it. One `<input type="number">` named by `aria-label` —
 * never wrapped in a `<label>`, which would name the unit twice — with the caller's bounds on the
 * native field and `aria-invalid` on a value it has refused.
 *
 * Keyboard is the browser's: Tab to reach, digits to type, ArrowUp and ArrowDown to step by
 * `step`.
 */
export function NumberField({
  label,
  value,
  onChange,
  unit,
  min,
  max,
  step = DEFAULT_STEP,
  invalid = false,
  disabled = false,
  id,
}: Readonly<NumberFieldProps>) {
  return (
    <div className={rowStyles}>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        aria-label={label}
        aria-invalid={invalid ? true : undefined}
        className={cx(fieldStyles, borderStyles[invalid ? 'invalid' : 'default'])}
        min={min}
        max={max}
        step={step}
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => onChange(parsedValue(event.target.value))}
      />
      {unit != null && (
        <span aria-hidden className={unitStyles}>
          {unit}
        </span>
      )}
    </div>
  );
}
