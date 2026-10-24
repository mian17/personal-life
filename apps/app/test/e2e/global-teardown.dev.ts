import { rmSync } from 'node:fs';
import { artifactsDir, devPidsFile } from './config';
import { heldSlot, releaseHeldSlot, stopRecorded } from './teardown';

/**
 * Stops the dev-mode services, clears their scratch state, and hands the dev
 * harness's slot back. The release sits in a `finally`, so a stop that fails
 * still frees the slot for the next worktree instead of leaking it until the
 * run ceiling reclaims it.
 */
export default async function globalTeardown(): Promise<void> {
  // Read the slot before releasing: the release deletes the claim it is read from.
  const slot = heldSlot();

  try {
    await stopRecorded(devPidsFile);
    rmSync(artifactsDir('e2e-state-dev', slot), { recursive: true, force: true });
  } finally {
    releaseHeldSlot();
  }
}
