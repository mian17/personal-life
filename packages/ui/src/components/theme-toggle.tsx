// Three-state appearance segment (Light / Dark / System) sharing `tab-bar.tsx`'s `.seg` classes,
// persisting the choice under `calm-theme` in `localStorage`.
'use client';

import { useEffect, useState } from 'react';
import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';
import { segActiveStyles, segControlStyles, segTroughBaseStyles } from './tab-bar';

type Theme = 'light' | 'dark' | 'system';

const THEME_STORAGE_KEY = 'calm-theme';
const THEME_ORDER: Theme[] = ['light', 'dark', 'system'];
const THEME_LABELS: Record<Theme, string> = { light: 'Light', dark: 'Dark', system: 'System' };

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') {
    return 'system';
  }
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : 'system';
}

function applyTheme(theme: Theme) {
  if (theme === 'system') {
    delete document.documentElement.dataset.theme;
    return;
  }
  document.documentElement.dataset.theme = theme;
}

/**
 * §8's `.seg--theme`: the three mutually exclusive appearance choices as one `aria-pressed`
 * group. The trough and the controls are `TabBar`/`Segmented`'s `.seg` (imported, not copied), only
 * the activation is different — a choice that repaints the document is a pressed button, not a
 * navigation, so `aria-current` would be the wrong signal.
 *
 * The stored choice lands on `html` in a mount effect, never during render, so the server output
 * stays deterministic (System pressed) and hydration never disagrees with it.
 */
export type ThemeToggleProps = Omit<
  ComponentPropsWithRef<'div'>,
  'role' | 'aria-label' | 'children'
> & {
  /**
   * Laid into a settings group, which owns the frame: full width, no trough chrome
   * (`revised-feedback.html:843-845`). Omitted renders the bordered trough for use on its own.
   */
  inGroup?: boolean;
};

/** §8's `.group > .seg--theme`: the group frames it, so the segment drops padding chrome and fills. */
const groupTroughStyles =
  'flex w-full items-center gap-[var(--s1)] p-[var(--s2)] rounded-none border-0 bg-transparent';

export function ThemeToggle({ className, inGroup = false, ...rest }: Readonly<ThemeToggleProps>) {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    setTheme(readStoredTheme());
  }, []);

  function chooseTheme(nextTheme: Theme) {
    setTheme(nextTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
  }

  return (
    <div
      role="group"
      aria-label="Appearance"
      className={cx(
        'ui-seg',
        'ui-seg--theme',
        '[&>*]:flex-1',
        inGroup ? groupTroughStyles : segTroughBaseStyles,
        className,
      )}
      {...rest}
    >
      {THEME_ORDER.map((value) => {
        const pressed = theme === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={pressed}
            onClick={() => chooseTheme(value)}
            className={cx(
              'ui-seg__btn',
              pressed && 'ui-seg__btn--active',
              segControlStyles,
              pressed && segActiveStyles,
            )}
          >
            {THEME_LABELS[value]}
          </button>
        );
      })}
    </div>
  );
}
