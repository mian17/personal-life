import { permanentRedirect } from 'next/navigation';

/**
 * I5 route move: the notes UI now lives at `/notes`. The old root permanently
 * redirects there, so every bookmark and old link keeps working.
 */
export default function Home() {
  permanentRedirect('/notes');
}
