// Composed registry `button` (icon control), snapshot `ui-registry-2026-10-26` (2026-10-26) — see vendor/shadcn/SNAPSHOT.md
'use client';

import { useEffect, useState } from 'react';
import type { ComponentPropsWithRef } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { IconButton } from './icon-button';

type Theme = 'system' | 'light' | 'dark';

const THEME_ORDER: Theme[] = ['system', 'light', 'dark'];
const THEME_LABELS: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' };
const THEME_ICONS: Record<Theme, typeof Monitor> = { system: Monitor, light: Sun, dark: Moon };

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') {
    return 'system';
  }
  const storedTheme = window.localStorage.getItem('theme');
  return storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : 'system';
}

function applyTheme(theme: Theme) {
  if (theme === 'system') {
    delete document.documentElement.dataset.theme;
    return;
  }
  document.documentElement.dataset.theme = theme;
}

function nextInCycle(theme: Theme): Theme {
  return THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
}

export type ThemeToggleProps = Omit<
  ComponentPropsWithRef<'button'>,
  'type' | 'onClick' | 'aria-label' | 'aria-pressed' | 'children'
>;

export function ThemeToggle({ className, ...rest }: Readonly<ThemeToggleProps>) {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    setTheme(readStoredTheme());
  }, []);

  const nextTheme = nextInCycle(theme);
  const ThemeIcon = THEME_ICONS[theme];

  function cycleTheme() {
    setTheme(nextTheme);
    window.localStorage.setItem('theme', nextTheme);
    applyTheme(nextTheme);
  }

  return (
    <IconButton
      label={`Theme: ${THEME_LABELS[theme]}. Activate for ${THEME_LABELS[nextTheme]}.`}
      aria-pressed={theme !== 'system'}
      onClick={cycleTheme}
      className={className}
      {...rest}
    >
      <ThemeIcon size={18} aria-hidden />
    </IconButton>
  );
}
