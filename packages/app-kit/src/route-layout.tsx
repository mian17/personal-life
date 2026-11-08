import type { Metadata } from 'next';
import { PortalAccentScope } from './portal-accent-scope';

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

/** The passthrough layout body every segment layout uses, carrying the area's accent scope. */
export type AppScope = 'notes' | 'todos' | 'meals' | 'pomodoro' | 'feedback';

export interface RouteLayoutProps {
  /**
   * The area this segment renders (`tokens.css`'s `[data-app='…']` accent scope). Omitted renders
   * no wrapper at all, for a segment that paints no accent of its own.
   */
  app?: AppScope;
  children: React.ReactNode;
}

/**
 * `display: contents`, so the scope element is a variable carrier and not a box: every height and
 * fill chain (`ListShell`'s `h-[100dvh]`, the matrix's growing slot) resolves exactly as it did
 * when the scope sat on `body`. The scope cannot live on `html` — tokens.css reaches its accents
 * through a descendant selector (`[data-theme='dark'] [data-app='…']`).
 *
 * `PortalAccentScope` repeats the scope on `body`, which is where the dialogs mount.
 */
export function RouteLayout({ app, children }: Readonly<RouteLayoutProps>): React.ReactElement {
  if (app == null) {
    return <>{children}</>;
  }
  return (
    <>
      <div data-app={app} className="contents">
        {children}
      </div>
      <PortalAccentScope app={app} />
    </>
  );
}
