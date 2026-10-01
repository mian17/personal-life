import type { Metadata } from 'next';

/**
 * The install metadata shared by every route-segment layout: the route's own
 * manifest plus the Apple Home Screen hints (`apple-mobile-web-app-capable` for
 * a standalone launch, `apple-mobile-web-app-title` for the icon name).
 */
export function routeLayoutMetadata(manifest: string, title: string): Metadata {
  return {
    manifest,
    appleWebApp: { capable: true, title, statusBarStyle: 'default' },
  };
}

/** The passthrough layout body (`<>{children}</>`) every segment layout uses. */
export function RouteLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return <>{children}</>;
}
