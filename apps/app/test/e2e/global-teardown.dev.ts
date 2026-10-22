import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { devPidsFile } from './config';
import { releaseHeldSlot, stopRecorded } from './teardown';

/**
 * Stops the dev-mode services, clears their scratch state, and hands the dev
 * harness's slot back. The release sits in a `finally`, so a stop that fails
 * still frees the slot for the next worktree instead of leaking it until the
 * run ceiling reclaims it.
 */
export default async function globalTeardown(): Promise<void> {
  try {
    await stopRecorded(devPidsFile);
    rmSync(join(__dirname, '..', '..', '.e2e-state-dev'), { recursive: true, force: true });
  } finally {
    releaseHeldSlot();
  }
}
