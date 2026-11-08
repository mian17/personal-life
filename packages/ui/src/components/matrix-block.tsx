// React 19 types dropped the global `JSX` namespace; it is exported by `react`.
import type { JSX, ReactNode } from 'react';
import { cx } from '../lib/cx';

// ui-blocks — four labelled quadrants in a 2×2 grid of muted panels at every
// width (smallest phones included). Presentational only: no data, no domain
// types, no domain copy, no routing. An `items == null` quadrant renders the
// `empty` slot instead.
export type MatrixTone = 'danger' | 'amber' | 'accent' | 'green';

export interface MatrixQuadrant {
  /** Stable key for the quadrant (app-supplied). */
  id: string;
  /** Quadrant heading text (app-supplied copy; the block bakes none). */
  label: string;
  /** The quadrant's content, rendered verbatim (app-composed). */
  items: ReactNode;
  /** Rendered in place of `items` when `items` is absent (app-supplied copy). */
  empty?: ReactNode;
  /** Heading tint for the quadrant. Off by default (unchanged markup). */
  tone?: MatrixTone;
}

export interface MatrixBlockProps {
  /** Exactly the quadrants to render, in render order. */
  quadrants: MatrixQuadrant[];
  /** Class passthrough (e2e hooks ride on it). */
  className?: string;
}

/**
 * The 2×2 grid, unconditional at every width. `minmax(0, 1fr)` tracks keep a long
 * word from widening a column; `auto-rows-[minmax(0,1fr)]` gives both rows equal
 * height so an empty quadrant matches a populated one, bounded so a tall cell
 * scrolls inside its box instead of lengthening the matrix (a bare `1fr` is
 * `minmax(auto, 1fr)`, which would grow).
 */
const gridStyles =
  'grid grid-cols-[repeat(2,minmax(0,1fr))] auto-rows-[minmax(0,1fr)] gap-[var(--s2)]';

/**
 * §8's `.quad`: a sunken panel with its own hairline, separated from its siblings by the grid
 * gap alone — no outer frame. `--s8 * 4 + --s1` is the reference's 132px floor, kept in tokens.
 */
const quadrantStyles =
  'flex flex-col gap-[var(--s2)] p-[var(--s3)] min-h-[calc(var(--s8)*4+var(--s1))] max-h-full overflow-hidden bg-surface-sunken border border-line rounded-[var(--r-lg)]';

/**
 * §8's `.quad__label`: small caps. A long label wraps onto a second, balanced line rather than
 * ellipsizing — the words a quadrant heading is told apart by are its last two, so an ellipsis
 * would leave two quadrants reading the same. The panel's `min-h` floor holds two lines.
 */
const labelStyles =
  'm-0 text-balance leading-[var(--lh-meta)] text-[length:var(--fs-count)] [font-weight:var(--fw-section-label)] tracking-[0.04em] uppercase text-ink-2';

/** Heading tint per quadrant tone (off by default). */
const labelToneStyles: Record<MatrixTone, string> = {
  danger: 'text-danger',
  amber: 'text-warn',
  accent: 'text-max',
  green: 'text-ok',
};

/**
 * Overflowing content scrolls inside the box; the heading stays put. The box's bottom edge
 * fades into the sunken panel, so a row cut by that edge reads as "more below" instead of as a
 * rendering fault — a touch browser paints no scrollbar to say the box scrolls. `content-start`
 * keeps the fade over empty box space when the box has room to spare.
 *
 * `items-start` is what makes this box the scroller. The app's group (`List`) clips its rows at
 * its own rounded edge with `overflow-hidden`, which makes it a scroll container and so gives it
 * a zero automatic minimum size; at the default `stretch` it would collapse to this box's height
 * and swallow its own rows, leaving the box nothing to scroll. Aligned to the top, the group
 * keeps its content height and the overflow arrives here.
 */
const itemsStyles =
  'grid content-start items-start gap-[var(--s2)] flex-1 min-h-0 overflow-y-auto ' +
  '[mask-image:linear-gradient(to_bottom,var(--surface-sunken)_calc(100%_-_var(--s3)),transparent)]';

/** Empty quadrant: muted and centred in the remaining box height. */
const emptyStyles =
  'flex-1 grid place-content-center m-0 text-ink-2 text-center text-[length:var(--fs-meta)]';

function quadrantClassName(quadrant: MatrixQuadrant): string {
  return cx(
    'ui-matrix__quadrant',
    quadrantStyles,
    quadrant.tone && `ui-matrix__quadrant--${quadrant.tone}`,
  );
}

function labelClassName(tone: MatrixTone | undefined): string {
  return cx('ui-matrix__label', labelStyles, tone && labelToneStyles[tone]);
}

export function MatrixBlock({ quadrants, className }: Readonly<MatrixBlockProps>): JSX.Element {
  return (
    <div className={cx('ui-matrix', gridStyles, className)}>
      {quadrants.map((quadrant) => (
        <section key={quadrant.id} className={quadrantClassName(quadrant)}>
          <h2 className={labelClassName(quadrant.tone)}>{quadrant.label}</h2>
          {quadrant.items != null ? (
            <div className={cx('ui-matrix__items', itemsStyles)}>{quadrant.items}</div>
          ) : (
            <p className={cx('ui-matrix__empty', emptyStyles)}>{quadrant.empty}</p>
          )}
        </section>
      ))}
    </div>
  );
}
