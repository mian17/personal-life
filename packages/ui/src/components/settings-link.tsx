import { SlidersHorizontal } from 'lucide-react';
import { IconLink } from './icon-link';

export interface SettingsLinkProps {
  href: string;
  className?: string;
}

/**
 * §8's `.iconbtn` settings control, in every app header: bare (transparent, no hairline),
 * `SlidersHorizontal` at the icon size, `--ink-2` ink from `IconLink`'s bare variant, and
 * trailing in `.phead`.
 *
 * The face is pinned here on purpose: the props are deliberately closed (no `label`, no
 * `children`, no `variant`), because a configurable settings control is exactly how five
 * headers drifted into four different looks. `href` is the app's resolved `settingsHref(...)`.
 */
export function SettingsLink({ href, className }: Readonly<SettingsLinkProps>) {
  return (
    <IconLink href={href} label="Settings" variant="bare" className={className}>
      <SlidersHorizontal size={20} aria-hidden />
    </IconLink>
  );
}
