import { RouteLayout, routeLayoutMetadata } from '@life/app-kit';
import { SnackbarProvider } from '@life/ui';

export const metadata = routeLayoutMetadata('/manifest-todos.json', 'Todos', '/icon-todos.png');

export default function TodosLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <RouteLayout>
      <SnackbarProvider>{children}</SnackbarProvider>
    </RouteLayout>
  );
}
