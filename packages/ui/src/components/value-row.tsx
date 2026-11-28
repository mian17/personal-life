import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface ValueRowProps {
  /** The row's name, always visible: "Duration", "Interval bells", "Ending bell". */
  label: ReactNode;
  /** The read-out at the row's end. Ignored when `control` is given — the design never shows both. */
  value?: ReactNode;
  /** A control at the row's end — the sheet's switch — instead of a read-out. */
  control?: ReactNode;
  /** The sheet's row is sunken, so its surface differs from the sheet it sits on. */
  tone?: 'surface' | 'sunken';
  /** Makes the whole row one button. Not combinable with `control`: a button cannot hold one. */
  onClick?: () => void;
  /** With `onClick`: the popup the row opens. The chevron is drawn only when one is set. */
  popup?: 'dialog' | 'menu';
  /** The popup's id, passed only while that element is mounted; see the accessibility note. */
  controls?: string;
}

/** The painted bar the row primitives around it deliberately do not draw. */
const rowStyles = cx(
  'ui-value-row',
  'flex w-full items-center justify-between gap-[var(--s3)]',
  'min-h-[var(--row-min-height)] rounded-[var(--r-md)] text-start',
);

/**
 * One fill and one inset per tone, never two: the sheet's sunken row also pulls its end inset one
 * step tighter, so the trailing control lands where the switch expects it.
 */
const toneStyles: Record<NonNullable<ValueRowProps['tone']>, string> = {
  surface: 'bg-surface ps-[var(--s4)] pe-[var(--s4)]',
  sunken: 'bg-surface-sunken ps-[var(--s4)] pe-[var(--s1)]',
};

/** The button mode's own states: a pointer, the `--press` wash, and the library's focus ring. */
const interactiveStyles = cx(
  'cursor-pointer [font:inherit] outline-none',
  'motion-safe:transition-colors active:bg-press',
  'focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)] focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-focus',
);

const labelStyles = cx(
  'ui-value-row__label',
  'text-ink text-[length:var(--fs-row-title)] leading-[var(--lh-row-title)] tracking-[var(--tracking-row-title)]',
);

const valueStyles = cx(
  'ui-value-row__value',
  'text-ink-2 text-[length:var(--fs-row-title)] leading-[var(--lh-row-title)]',
);

/** The control keeps its own box; the row only makes room for it at the far end. */
const controlStyles = 'ui-value-row__control flex shrink-0 items-center';

/** The chevron is a text glyph, so the ink, the size and the leading are the design's three tokens. */
const chevronStyles =
  'ui-value-row__chevron text-ink-3 text-[length:var(--fs-body)] leading-[var(--lh-control)]';

/**
 * The filled label/value bar. Static by default — no role and no tab stop — and a disclosure when
 * it is given both `onClick` and a `popup`: one button whose name is its own text, carrying
 * `aria-haspopup` and, while the popup is mounted, `aria-controls`.
 *
 * `aria-controls` is the caller's to time: `Dialog` portals its content, so a closed sheet leaves
 * the IDREF pointing at nothing. There is no `aria-expanded` — a button that opens a modal is the
 * `aria-haspopup="dialog"` pattern, and an expanded state adds nothing a dialog does not say.
 */
export function ValueRow({
  label,
  value,
  control,
  tone = 'surface',
  onClick,
  popup,
  controls,
}: Readonly<ValueRowProps>) {
  // A `<button>` cannot contain the switch, and the design's switch row has no row-level action.
  const asButton = control == null && onClick != null;
  const classes = cx(rowStyles, toneStyles[tone], asButton && interactiveStyles);

  const content = (
    <>
      <span className={labelStyles}>{label}</span>
      {control == null ? (
        value != null && <span className={valueStyles}>{value}</span>
      ) : (
        <span className={controlStyles}>{control}</span>
      )}
      {popup != null && (
        <span aria-hidden className={chevronStyles}>
          ›
        </span>
      )}
    </>
  );

  if (!asButton) return <div className={classes}>{content}</div>;

  return (
    <button
      type="button"
      aria-haspopup={popup}
      aria-controls={controls}
      className={classes}
      onClick={onClick}
    >
      {content}
    </button>
  );
}
