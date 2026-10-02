'use client';

import { useRef, useState } from 'react';
import { Switch } from '@life/ui';
import { setPref } from '@life/app-kit/preference-action';
import { TOGGLE_DEBOUNCE_MS, useDebouncedCallback } from '@/lib/use-debounced-callback';

/**
 * Controlled wrapper: seeds local state from the server-read `checked` value and
 * persists the settled value through app-kit's server action (rapid toggles
 * coalesce; a toggle back to the server value sends nothing). The atom stays
 * presentational. `setPref` comes from the client-safe subpath — the barrel
 * re-exports the server-only `readPref`/`next/headers`, which must not enter this
 * client graph (`SPEC-app-kit-settings`, Subpath export).
 */
export function MatrixSwitch({ checked }: { checked: boolean }) {
  const [on, setOn] = useState(checked);
  const persisted = useRef(checked);
  const debouncedFlush = useDebouncedCallback(TOGGLE_DEBOUNCE_MS);

  return (
    <Switch
      label="Eisenhower matrix"
      checked={on}
      onCheckedChange={(next) => {
        setOn(next);
        debouncedFlush(() => {
          if (next === persisted.current) return;
          persisted.current = next;
          void setPref('matrix', next);
        });
      }}
    />
  );
}
