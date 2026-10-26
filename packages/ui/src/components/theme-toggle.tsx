'use client';

import { useEffect, useState } from 'react';
import type { ComponentPropsWithRef } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { IconButton } from './icon-button';

type Theme = 'system' | 'light' | 'dark';

const ORDER: Theme[] = ['system', 'light', 'dark'];
const LABELS: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' };
const ICONS: Record<Theme, typeof Monitor> = { system: Monitor, light: Sun, dark: Moon };

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

export type ThemeToggleProps = Omit<
  ComponentPropsWithRef<'button'>,
  'type' | 'onClick' | 'aria-label' | 'aria-pressed' | 'children'
>;

export function ThemeToggle({ className, ...rest }: Readonly<ThemeToggleProps>) {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    setTheme(readStored());
  }, []);

  const nextTheme = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  const Icon = ICONS[theme];

  function cycle() {
    setTheme(nextTheme);
    window.localStorage.setItem('theme', nextTheme);
    apply(nextTheme);
  }

  return (
    <IconButton
      label={`Theme: ${LABELS[theme]}. Activate for ${LABELS[nextTheme]}.`}
      aria-pressed={theme !== 'system'}
      onClick={cycle}
      className={className}
      {...rest}
    >
      <Icon size={18} aria-hidden />
    </IconButton>
  );
}
