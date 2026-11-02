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

const ACCENT_SCOPED_ROUTES = ['notes', 'todos', 'meals', 'pomodoro', 'feedback'];

/** Appearance plumbing, before first paint: the stored scheme lands on `html`, the screen's
    accent scope on `body`. `data-app` cannot live on `html` because tokens.css reaches its
    accents through a descendant selector (`[data-theme='dark'] [data-app='…']`).
    ponytail: this reads the first path segment, so a client-side route change keeps the
    previous accent until reload — each screen sets its own scope in Tasks 6–10 and this
    line goes with it. */
const applyStoredAppearance = `try{var choice=localStorage.getItem('calm-theme');if(choice==='light'||choice==='dark'){document.documentElement.dataset.theme=choice}var app=location.pathname.split('/')[1];if(${JSON.stringify(ACCENT_SCOPED_ROUTES)}.indexOf(app)>-1){document.body.dataset.app=app}}catch(unavailableStorage){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: applyStoredAppearance }} />
        <TimeZoneSync />
        {children}
      </body>
    </html>
  );
}
