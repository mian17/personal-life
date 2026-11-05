import { RouteLayout, routeLayoutMetadata } from '@life/app-kit';

export const metadata = routeLayoutMetadata('/manifest-notes.json', 'Notes', '/icon-notes.png');

export default function NotesLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <RouteLayout app="notes">{children}</RouteLayout>;
}
