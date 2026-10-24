import { rmSync } from 'node:fs';
import { stopThrowawayContainers } from './stack';
import { heldSlot, releaseHeldSlot, stopRecorded } from './teardown';
import { artifactsDir, prodPidsFile } from './config';

/**
 * Stops the production-build services, removes this slot's three throwaway
 * containers, clears the scratch state, and hands the slot back. The release sits
 * in a `finally`, so a stop that fails still frees the slot for the next worktree.
 */
export default async function globalTeardown(): Promise<void> {
  const slot = heldSlot();

  try {
    await stopRecorded(prodPidsFile);
    stopThrowawayContainers(slot);
    rmSync(artifactsDir('e2e-state', slot), { recursive: true, force: true });
  } finally {
    releaseHeldSlot();
  }
}
