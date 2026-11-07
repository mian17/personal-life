'use client';

import { useState } from 'react';
import { Button } from './button';

export interface LoadMoreProps {
  /**
   * Fetch and append the next cursor page. Owns nothing but the await: the caller
   * decides what "more" means, this control only reports pending/failed state.
   */
  onLoadMore: () => Promise<void>;
  /** Visible and accessible text; the frozen label is the default. */
  label?: string;
}

/**
 * The one load-more control (`SPEC-load-more`): a real focusable `Button` under a
 * list, so the next page is one Enter away — never a div with a click handler, and
 * never a click handler on a row (rows are links here, and a row that both navigates
 * and pages is ambiguous).
 *
 * The parent decides whether more exists and simply omits this control when there is
 * no next cursor: absence is the whole "end of list" state, so this component never
 * renders a disabled leftover and never needs a `hasMore` prop it could disagree with.
 *
 * `try/finally` is the failure contract: a rejected page re-enables the control
 * instead of wedging it on "Loading". The rejection is swallowed rather than
 * rethrown — the caller owns the message on its own surface (an `AlertBanner` above
 * the list), and `void`ing a promise that can reject would leave the browser an
 * unhandled rejection for a failure the UI already showed.
 */
export function LoadMore({ onLoadMore, label = 'Load more' }: Readonly<LoadMoreProps>) {
  const [loading, setLoading] = useState(false);

  async function loadNextPage(): Promise<void> {
    // A second press while a page is in flight would append it twice: the disabled
    // attribute covers the pointer, this guard covers a queued Enter.
    if (loading) return;
    setLoading(true);
    try {
      await onLoadMore();
    } catch {
      // Re-arming is the whole recovery; the caller's banner names the failure.
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="ghost" disabled={loading} onClick={() => void loadNextPage()}>
      {loading ? 'Loading' : label}
    </Button>
  );
}
