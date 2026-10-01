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

export function MatrixBlock({ quadrants, className }: MatrixBlockProps): JSX.Element {
  return (
    <div className={cx('ui-matrix', className)}>
      {quadrants.map((quadrant) => (
        <section
          key={quadrant.id}
          className={cx(
            'ui-matrix__quadrant',
            quadrant.tone && `ui-matrix__quadrant--${quadrant.tone}`,
          )}
        >
          <h2 className="ui-matrix__label">{quadrant.label}</h2>
          {quadrant.items != null ? (
            <div className="ui-matrix__items">{quadrant.items}</div>
          ) : (
            <p className="ui-matrix__empty">{quadrant.empty}</p>
          )}
        </section>
      ))}
    </div>
  );
}
