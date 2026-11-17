'use client';

import { useState } from 'react';
import { Switch } from '@life/ui';

/**
 * The bells' on/off control in the meditation settings form (plan Task [12]: `Switch`).
 *
 * A `Switch` is a button, and a button submits no field, so the state the switch shows also
 * rides a hidden field under the name the save action reads. The switch is the control the
 * plan names; the hidden field is plumbing — it renders nothing, so Contract 1 Rule 1's
 * hidden-input exemption covers it.
 */
export function BellsSwitch({ enabled }: Readonly<{ enabled: boolean }>) {
  const [on, setOn] = useState(enabled);

  return (
    <>
      <Switch label="Interval bells" checked={on} onCheckedChange={setOn} />
      <input type="hidden" name="bellsEnabled" value={on ? 'on' : 'off'} />
    </>
  );
}
