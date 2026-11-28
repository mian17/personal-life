import type { Metadata } from 'next';
import { RouteLayout } from '@life/app-kit';

export const metadata: Metadata = { title: 'Meditation' };

export default function MeditationLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <RouteLayout app="meditation">{children}</RouteLayout>;
}
