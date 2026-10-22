import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { stopThrowawayPostgres } from './stack';
import { heldSlot, releaseHeldSlot, stopRecorded } from './teardown';
import { prodPidsFile } from './config';

/**
 * Stops the production-build services, removes this slot's throwaway Postgres,
 * clears the scratch state, and hands the slot back. The release sits in a
 * `finally`, so a stop that fails still frees the slot for the next worktree.
 */
export default async function globalTeardown(): Promise<void> {
  const slot = heldSlot();

  try {
    await stopRecorded(prodPidsFile);
    stopThrowawayPostgres(slot);
    rmSync(join(__dirname, '..', '..', '.e2e-state'), { recursive: true, force: true });
  } finally {
    releaseHeldSlot();
  }
}
