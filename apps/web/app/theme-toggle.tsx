'use client';

import { useEffect, useState } from 'react';

type Theme = 'system' | 'light' | 'dark';

const ORDER: Theme[] = ['system', 'light', 'dark'];
const LABELS: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' };

function readStored(): Theme {
  if (typeof window === 'undefined') {
    return 'system';
  }
  const value = window.localStorage.getItem('theme');
  return value === 'light' || value === 'dark' ? value : 'system';
}

function apply(theme: Theme) {
  if (theme === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    setTheme(readStored());
  }, []);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    setTheme(next);
    window.localStorage.setItem('theme', next);
    apply(next);
  }

  return (
    <button
      type="button"
      onClick={cycle}
      className="theme-toggle"
      aria-label={`Theme: ${LABELS[theme]}. Activate for ${LABELS[ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]]}.`}
      aria-pressed={theme !== 'system'}
    >
      {LABELS[theme]}
    </button>
  );
}
