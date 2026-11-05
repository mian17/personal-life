import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface SettingsRowProps {
  /** Row label (left column). App-supplied copy. */
  label: ReactNode;
  /** Optional muted description under the label. */
  description?: ReactNode;
  /** The control rendered in the right column (e.g. `<ThemeToggle />`, `<Switch/>`). */
  control?: ReactNode;
  /** Route the row navigates to: the label becomes the link and the row points at it. */
  href?: string;
  /** In-page action: the label becomes a button (a link with no destination is not one). */
  onClick?: () => void;
  /** Class passthrough. */
  className?: string;
}

/**
 * One setting on a single line at every width: label column left, the caller's
 * control column right. The reference `.row` has no media query, so neither does
 * this one — a narrow screen ellipsizes the label instead of restacking it.
 *
 * With `href` the label is the link target and the row's far end carries the
 * chevron (plus the caller's control, when one is given). The row itself stays a
 * `div`: the label's anchor is stretched over the whole row instead of wrapping
 * it, which keeps the markup valid when the control is itself interactive (a pill
 * button, a toggle) — and the control column lets presses through to that
 * overlay, so the pill, the chevron and the empty middle all reach the row's
 * destination. Only a real control opts back in, so it still activates itself.
 *
 * A control may be prose (`StatusText` under a switch that cannot render yet), and
 * prose has to wrap inside the row rather than run past the card's clipped edge.
 * So the control column may shrink — its `min-width: auto` floor is its longest word,
 * so prose wraps while a pill or a toggle keeps its size — and the label column
 * carries its text as a flex basis (`flex-auto`) instead of a zero one, so the two
 * share a narrow row instead of the label vanishing to nothing.
 */
const rowStyles = 'relative flex items-center gap-[var(--s3)]';

/** Only a row with a destination or an action reads as pressable — a bare label row does not. */
const interactiveRowStyles = 'cursor-pointer active:bg-press';

/** The label column asks for its own text width, so a shrinking control leaves it some room. */
const textStyles = 'flex flex-auto flex-col gap-[var(--s1)] min-w-0';

/** A label may ellipsize only if its own box is allowed to shrink. */
const labelStyles = 'min-w-0 truncate text-[length:var(--fs-row-title)]';

/** §8's `.row__meta` treatment for the optional second line, clamped so it never grows the row. */
const descriptionStyles = cx(
  'line-clamp-2',
  'text-ink-2 text-[length:var(--fs-meta)] leading-[var(--lh-meta)]',
);

/** The control keeps its natural width but may shrink under it, so a text control wraps. */
const controlStyles = 'relative flex items-center gap-[var(--s2)]';

/**
 * An interactive row's control column is click-through: painted above the stretched label, a
 * read-out pill or the chevron would otherwise swallow the press and leave a dead band on the row.
 * Only a real control opts back in — a pill link, a toggle, a field — so it keeps its own click
 * while a non-interactive pill and the decorative chevron pass the press to the row's overlay.
 * A bare row (no destination, no action) keeps its column hit-testable, so prose stays selectable.
 */
const clickThroughStyles = cx(
  'pointer-events-none',
  '[&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_input]:pointer-events-auto',
  '[&_select]:pointer-events-auto [&_textarea]:pointer-events-auto',
);

/** The label's hit area is the whole row, so no empty space on the row is dead. */
const stretchStyles = "after:absolute after:inset-0 after:content-['']";

/** The row label as a link: the row's own ink (so `:visited` cannot repaint it), no underline. */
const linkLabelStyles = cx(
  'text-ink no-underline',
  'outline-none focus-visible:outline-solid focus-visible:outline-[length:var(--focus-ring)]',
  'focus-visible:outline-offset-[var(--focus-ring)] focus-visible:outline-focus',
  stretchStyles,
);

/** The label as a button: only the UA chrome is shed, so it is the link's twin. */
const buttonLabelStyles = cx(
  'cursor-pointer appearance-none border-0 bg-transparent p-0 text-left',
  '[font-family:inherit] [font-size:inherit] [line-height:inherit]',
  linkLabelStyles,
);

/** The label's box: an anchor when the row routes, a button when it acts, plain text otherwise. */
function RowLabel({
  label,
  href,
  onClick,
}: Readonly<Pick<SettingsRowProps, 'label' | 'href' | 'onClick'>>) {
  const baseClassName = cx('ui-settings-row__label', labelStyles);

  if (href != null) {
    return (
      <Link href={href} className={cx(baseClassName, linkLabelStyles)}>
        {label}
      </Link>
    );
  }

  if (onClick != null) {
    return (
      <button type="button" onClick={onClick} className={cx(baseClassName, buttonLabelStyles)}>
        {label}
      </button>
    );
  }

  return <span className={baseClassName}>{label}</span>;
}

export function SettingsRow({
  label,
  description,
  control,
  href,
  onClick,
  className,
}: Readonly<SettingsRowProps>) {
  const isInteractive = href != null || onClick != null;
  const labelNode = <RowLabel label={label} href={href} onClick={onClick} />;

  const chevron = isInteractive && (
    <ChevronRight size={18} aria-hidden className="shrink-0 text-ink-3" />
  );

  return (
    <div
      className={cx(
        'ui-settings-row',
        rowStyles,
        isInteractive && interactiveRowStyles,
        className,
      )}
    >
      <div className={cx('ui-settings-row__text', textStyles)}>
        {labelNode}
        {description != null && (
          <span className={cx('ui-settings-row__desc', descriptionStyles)}>{description}</span>
        )}
      </div>
      <div
        className={cx(
          'ui-settings-row__control',
          controlStyles,
          isInteractive && clickThroughStyles,
        )}
      >
        {control}
        {chevron}
      </div>
    </div>
  );
}
