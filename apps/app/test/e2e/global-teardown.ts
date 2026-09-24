import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { servicePidsFile } from './config';

/** Stops the services recorded by global-setup and removes the scratch state. */
export default async function globalTeardown(): Promise<void> {
  const file = join(__dirname, servicePidsFile);
  let pids: number[] = [];
  try {
    pids = (JSON.parse(readFileSync(file, 'utf8')) as { pids: number[] }).pids;
  } catch {
    // No recorded services; still clear scratch state below.
  }
  for (const pid of pids) {
    if (!pid) continue;
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  rmSync(file, { force: true });
  // Remove the e2e scratch DBs/keys (never any service's real data dir).
  rmSync(join(__dirname, '..', '..', '.e2e-state'), { recursive: true, force: true });
}
