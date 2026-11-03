import '@life/ui/styles.css';
import { TimeZoneSync } from './time-zone-sync';

export const metadata = {
  title: 'Personal Life',
  description: 'Personal notes API and UI',
  icons: { icon: '/icon.svg' },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1115' },
  ],
};

/** Appearance plumbing, before first paint: the stored scheme lands on `html`. The screen's
    accent scope is not this script's job — each area layout declares its own scope, so the
    accent follows a client-side route change with no reload. The scope cannot live on `html`
    because tokens.css reaches its accents through a descendant selector. */
const applyStoredTheme = `try{var choice=localStorage.getItem('calm-theme');if(choice==='light'||choice==='dark'){document.documentElement.dataset.theme=choice}}catch(unavailableStorage){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: applyStoredTheme }} />
        <TimeZoneSync />
        {children}
      </body>
    </html>
  );
}
