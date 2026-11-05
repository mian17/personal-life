'use client';

import { useState } from 'react';
import { ButtonLink, FabMenu } from '@life/ui';
import { Plus } from 'lucide-react';

/**
 * The day view's two log doors (`SPEC-manual-log-ui`): photo capture and the
 * manual food search. `FabMenu` is a controlled block that stores no open
 * state, so the one bit of state lives in this client island — the day view
 * itself stays a server component. The plus icon is the "add a meal" affordance
 * (a camera read as "photo only"); the option names are the frozen e2e strings
 * (`PHOTO_DOOR` / `FOOD_DOOR`), so they stay verbatim. Each option is the outlined
 * secondary control, so it takes the button radius inside the panel's own `--r-lg`.
 */
export function MealDoors() {
  const [open, setOpen] = useState(false);

  return (
    <FabMenu
      label="Log a meal"
      icon={<Plus size={28} strokeWidth={2.5} aria-hidden />}
      open={open}
      onOpenChange={setOpen}
    >
      <ButtonLink variant="ghost" href="/meals/entry/new?door=photo" role="menuitem">
        Log meal from photo
      </ButtonLink>
      <ButtonLink variant="ghost" href="/meals/entry/new?door=food" role="menuitem">
        Log food
      </ButtonLink>
    </FabMenu>
  );
}
