'use client';

import { useState } from 'react';
import { Switch } from '@life/ui';
import { setPref } from '@life/app-kit/preference-action';

/**
 * Controlled wrapper: seeds local state from the server-read `checked` value and
 * persists each toggle through app-kit's server action. The atom stays
 * presentational. `setPref` comes from the client-safe subpath — the barrel
 * re-exports the server-only `readPref`/`next/headers`, which must not enter this
 * client graph (`SPEC-app-kit-settings`, Subpath export).
 */
export function MatrixSwitch({ checked }: { checked: boolean }) {
  const [on, setOn] = useState(checked);
  return (
    <Switch
      label="Eisenhower matrix"
      checked={on}
      onCheckedChange={(next) => {
        setOn(next);
        void setPref('matrix', next);
      }}
    />
  );
}
