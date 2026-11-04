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
 * button, a toggle) — that control column is raised above the overlay so it keeps
 * its own clicks.
 */
const rowStyles = 'relative flex items-center gap-[var(--s3)]';

/** Only a row with a destination or an action reads as pressable — a bare label row does not. */
const interactiveRowStyles = 'cursor-pointer active:bg-press';

/** The label column takes the row's leftover width, so a long label never pushes the control out. */
const textStyles = 'flex flex-1 flex-col gap-[var(--s1)] min-w-0';

/** A label may ellipsize only if its own box is allowed to shrink. */
const labelStyles = 'min-w-0 truncate text-[length:var(--fs-row-title)]';

/** §8's `.row__meta` treatment for the optional second line, clamped so it never grows the row. */
const descriptionStyles = cx(
  'line-clamp-2',
  'text-ink-2 text-[length:var(--fs-meta)] leading-[var(--lh-meta)]',
);

/** The control keeps its intrinsic width, centres against the label line, and stays above the overlay. */
const controlStyles = 'relative flex items-center gap-[var(--s2)] shrink-0';

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

export function SettingsRow({
  label,
  description,
  control,
  href,
  onClick,
  className,
}: Readonly<SettingsRowProps>) {
  const isInteractive = href != null || onClick != null;

  const labelNode =
    href != null ? (
      <Link href={href} className={cx('ui-settings-row__label', labelStyles, linkLabelStyles)}>
        {label}
      </Link>
    ) : onClick != null ? (
      <button
        type="button"
        onClick={onClick}
        className={cx('ui-settings-row__label', labelStyles, buttonLabelStyles)}
      >
        {label}
      </button>
    ) : (
      <span className={cx('ui-settings-row__label', labelStyles)}>{label}</span>
    );

  const chevron = isInteractive && <ChevronRight size={18} aria-hidden className="text-ink-3" />;

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
      <div className={cx('ui-settings-row__control', controlStyles)}>
        {control}
        {chevron}
      </div>
    </div>
  );
}
