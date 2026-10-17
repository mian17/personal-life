'use client';

import { useState } from 'react';
import { FabMenu, Pill } from '@life/ui';
import { Camera } from 'lucide-react';

/**
 * The day view's two log doors (`SPEC-manual-log-ui`): photo capture and the
 * manual food picker. `FabMenu` is a controlled block that stores no open
 * state, so the one bit of state lives in this client island — the day view
 * itself stays a server component. The photo option keeps the visible name the
 * e2e journey pins (`PHOTO_DOOR`).
 */
export function MealDoors() {
  const [open, setOpen] = useState(false);

  return (
    <FabMenu
      label="Log a meal"
      icon={<Camera size={28} strokeWidth={2.5} aria-hidden />}
      open={open}
      onOpenChange={setOpen}
    >
      <Pill as="a" href="/meals/entry/new?door=photo" role="menuitem" size="filter">
        Log meal from photo
      </Pill>
      <Pill as="a" href="/meals/entry/new?door=food" role="menuitem" size="filter">
        Log food
      </Pill>
    </FabMenu>
  );
}
