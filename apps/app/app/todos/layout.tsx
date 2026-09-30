import type { Metadata } from 'next';

export const metadata: Metadata = { manifest: '/manifest-todos.json' };

export default function TodosLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
