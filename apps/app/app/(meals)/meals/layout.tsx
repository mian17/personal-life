import { RouteLayout, routeLayoutMetadata } from '@life/app-kit';
import { SnackbarProvider } from '@life/ui';

export const metadata = routeLayoutMetadata('/manifest-meals.json', 'Meals', '/icon-meals.png');

export default function MealsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <RouteLayout app="meals">
      <SnackbarProvider>{children}</SnackbarProvider>
    </RouteLayout>
  );
}
