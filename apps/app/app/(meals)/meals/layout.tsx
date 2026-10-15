import { RouteLayout, routeLayoutMetadata } from '@life/app-kit';
import { SnackbarProvider } from '@life/ui';

export const metadata = routeLayoutMetadata('/manifest-meals.json', 'Meals', '/icon-meals.png');

export default function MealsLayout({ children }: { children: React.ReactNode }) {
  return (
    <RouteLayout>
      <SnackbarProvider>{children}</SnackbarProvider>
    </RouteLayout>
  );
}
