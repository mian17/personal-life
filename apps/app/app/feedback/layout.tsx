import { RouteLayout, routeLayoutMetadata } from '@life/app-kit';

export const metadata = routeLayoutMetadata('/manifest-feedback.json', 'Feedback', '/icon-feedback.png');

export default function FeedbackLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <RouteLayout app="feedback">{children}</RouteLayout>;
}
