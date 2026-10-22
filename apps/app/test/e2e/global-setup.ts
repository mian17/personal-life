import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startStack, type StackConfig } from './stack';
import { prodPidsFile, repoRoot, testPorts } from './config';
import { claimSlotForRun } from './slot-queue';
import { recordHeldSlot, releaseHeldSlot } from './teardown';

/**
 * Production-build e2e stack: the real Docker artifact (`next build` output),
 * access gate active, `localhost` origin. Mirrors `docker compose up` behavior.
 *
 * The slot is claimed before anything is built or bound, so this run owns every
 * port it touches for its whole life. `global-teardown.ts` hands it back, and a
 * setup that aborts hands it back here instead of leaking it.
 */
export default async function globalSetup(): Promise<void> {
  const claim = claimSlotForRun(repoRoot());
  recordHeldSlot(claim);

  try {
    const services = await startStack(productionStackConfig(claim.slot));
    recordServicePids(services.map((service) => service.child.pid));
  } catch (error) {
    releaseHeldSlot();
    throw error;
  }
}

function productionStackConfig(slot: number): StackConfig {
  const { idpPort, notePort, tagsPort, todoPort, mealPort, feedbackPort, appPort } = testPorts(slot);

  return {
    mode: 'production',
    idpPort,
    notePort,
    tagsPort,
    todoPort,
    mealPort,
    feedbackPort,
    appPort,
    appOrigin: `http://localhost:${appPort}`,
    // Never under any service's real `data/` directory.
    stateDir: join(repoRoot(), 'apps/app/.e2e-state'),
    slot,
  };
}

/** Leaves the PIDs for `global-teardown.ts`, which stops what this run started. */
function recordServicePids(pids: (number | undefined)[]): void {
  writeFileSync(join(__dirname, prodPidsFile), JSON.stringify({ pids }));
}
