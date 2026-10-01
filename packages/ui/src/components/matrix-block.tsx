// React 19 types dropped the global `JSX` namespace; it is exported by `react`.
import type { JSX, ReactNode } from 'react';
import { cx } from '../lib/cx';

// ui-blocks — a labelled 2×2 (or stacked) presentation of four quadrants.
// Presentational only: no data, no domain types, no domain copy, no routing.
export interface MatrixQuadrant {
  /** Stable key for the quadrant (app-supplied). */
  id: string;
  /** Quadrant heading text (app-supplied copy; the block bakes none). */
  label: string;
  /** The quadrant's content, rendered verbatim (app-composed). */
  items: ReactNode;
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
        <section key={quadrant.id} className="ui-matrix__quadrant">
          <h2 className="ui-matrix__label">{quadrant.label}</h2>
          <div className="ui-matrix__items">{quadrant.items}</div>
        </section>
      ))}
    </div>
  );
}
