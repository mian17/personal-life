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
  'grid grid-cols-[repeat(2,minmax(0,1fr))] auto-rows-[minmax(0,1fr)] gap-[var(--space-0-5)]';

/** A muted panel, separated from its siblings by the grid gap alone — no outer frame. */
const quadrantStyles =
  'flex flex-col gap-[var(--space-0-5)] p-[var(--space-1)] min-h-[var(--space-5)] max-h-full overflow-hidden bg-panel rounded-[var(--radius-lg)]';

/** The heading keeps one line: a long label ellipsizes rather than widening the panel. */
const labelStyles = 'm-0 truncate text-[length:var(--space-0-7)] font-bold';

/** Heading tint per quadrant tone (off by default). */
const labelToneStyles: Record<MatrixTone, string> = {
  danger: 'text-danger',
  amber: 'text-amber',
  accent: 'text-accent',
  green: 'text-green',
};

/** Overflowing content scrolls inside the box; the heading stays put. */
const itemsStyles = 'grid gap-[var(--space-0-25)] flex-1 min-h-0 overflow-y-auto';

/** Empty quadrant: muted and centred in the remaining box height. */
const emptyStyles = 'flex-1 grid place-content-center m-0 text-muted text-center text-[length:var(--space-0-85)]';

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
