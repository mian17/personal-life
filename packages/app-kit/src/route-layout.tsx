import type { Metadata } from 'next';

/**
 * The install metadata shared by every route-segment layout: the route's own
 * manifest, its Home Screen icon, and the Apple Home Screen hints
 * (`apple-mobile-web-app-capable` for a standalone launch,
 * `apple-mobile-web-app-title` for the icon name).
 */
export function routeLayoutMetadata(manifest: string, title: string, icon: string): Metadata {
  return {
    manifest,
    icons: { icon: '/icon.svg', apple: icon },
    appleWebApp: { capable: true, title, statusBarStyle: 'default' },
  };
}

/** The passthrough layout body (`<>{children}</>`) every segment layout uses. */
export function RouteLayout({ children }: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  return <>{children}</>;
}
