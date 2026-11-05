'use client';

import { useEffect } from 'react';
import type { AppScope } from './route-layout';

/**
 * Radix mounts its portals on `document.body`, outside the `RouteLayout` scope wrapper, so the
 * accent a dialog's primary button paints (`bg-max`) would resolve against an undeclared `--max`.
 * Mirroring the segment's scope onto `body` — the one ancestor the portal shares with the layout —
 * is what keeps a portalled surface in its area's accent. Renders nothing.
 */
export function PortalAccentScope({ app }: Readonly<{ app: AppScope }>): null {
  useEffect(() => {
    document.body.dataset.app = app;
    return () => {
      delete document.body.dataset.app;
    };
  }, [app]);

  return null;
}
