import { IconLink } from '@life/ui';
import { Target } from 'lucide-react';

/** The Meals toolbar nav icons, shared by every meals route. */
export function MealsNav() {
  return (
    <IconLink href="/meals/target" label="Daily target">
      <Target size={20} aria-hidden />
    </IconLink>
  );
}
