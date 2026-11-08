import { writeFileSync } from 'node:fs';
import { startStack, type StackConfig } from './stack';
import { devPidsFile, artifactsDir, devPorts, pidsFilePath, repoRoot } from './config';
import { claimSlotForRun } from './slot-queue';
import { recordHeldSlot, releaseHeldSlot } from './teardown';

/**
 * Development-mode e2e stack: `next dev` exactly as `npm run dev` runs it, on
 * scratch DBs. This is the runtime the human actually uses, and the only one
 * where the dev server's middleware loopback-host normalization exists.
 *
 * The dev harness claims a slot of its own, before `next dev` boots, so a dev
 * run never inherits a production run's claim and two worktrees running dev at
 * once land on different 32xx bands. A setup that aborts hands the slot back
 * here; `global-teardown.dev.ts` hands it back on every other exit path.
 */
export default async function globalSetup(): Promise<void> {
  const claim = claimSlotForRun(repoRoot());
  recordHeldSlot(claim);

  try {
    const services = await startStack(developmentStackConfig(claim.slot));
    recordServicePids(services.map((service) => service.child.pid));
  } catch (error) {
    releaseHeldSlot();
    throw error;
  }
}

function developmentStackConfig(slot: number): StackConfig {
  const { idpPort, notePort, tagsPort, todoPort, mealPort, focusPort, appPort } = devPorts(slot);

  return {
    mode: 'development',
    idpPort,
    notePort,
    tagsPort,
    todoPort,
    mealPort,
    focusPort,
    appPort,
    // Dev is reached on 127.0.0.1 (the human's URL and the app's default).
    appOrigin: `http://127.0.0.1:${appPort}`,
    // Outside the repository: this lane boots `next dev`, whose Turbopack
    // watches `apps/app`, so scratch writes in there reload the page under test.
    stateDir: artifactsDir('e2e-state-dev', slot),
    slot,
  };
}

/** Leaves the PIDs for `global-teardown.dev.ts`, which stops what this run started. */
function recordServicePids(pids: (number | undefined)[]): void {
  writeFileSync(pidsFilePath(devPidsFile), JSON.stringify({ pids }));
}
