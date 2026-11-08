import { RouteLayout, routeLayoutMetadata } from '@life/app-kit';

export const metadata = routeLayoutMetadata('/manifest-pomodoro.json', 'Pomodoro', '/icon-pomodoro.png');

export default function PomodoroLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <RouteLayout app="pomodoro">{children}</RouteLayout>;
}
