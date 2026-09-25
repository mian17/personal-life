import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { stopRecorded } from './teardown';

/** Stops the dev-mode services and clears their scratch state. */
export default async function globalTeardown(): Promise<void> {
  await stopRecorded('service-pids-dev.json');
  rmSync(join(__dirname, '..', '..', '.e2e-state-dev'), { recursive: true, force: true });
}
