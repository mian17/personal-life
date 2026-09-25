import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { stopRecorded } from './teardown';

/** Stops the production-build services and clears their scratch state. */
export default async function globalTeardown(): Promise<void> {
  await stopRecorded('service-pids-prod.json');
  rmSync(join(__dirname, '..', '..', '.e2e-state'), { recursive: true, force: true });
}
