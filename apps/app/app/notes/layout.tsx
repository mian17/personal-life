import type { Metadata } from 'next';

export const metadata: Metadata = { manifest: '/manifest-notes.json' };

export default function NotesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
