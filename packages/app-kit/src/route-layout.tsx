import type { Metadata } from 'next';

/** The `{ manifest }` metadata shared by every route-segment layout. */
export function routeLayoutMetadata(manifest: string): Metadata {
  return { manifest };
}

/** The passthrough layout body (`<>{children}</>`) every segment layout uses. */
export function RouteLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return <>{children}</>;
}
