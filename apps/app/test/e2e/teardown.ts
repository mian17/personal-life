import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Reads a recorded PID file and stops each service's whole process group.
 * Services are spawned detached (see services.ts), so the negative pid kills
 * `next dev`'s forked `next-server` child too.
 */
export async function stopRecorded(file: string): Promise<void> {
  let pids: number[] = [];
  try {
    pids = (JSON.parse(readFileSync(join(__dirname, file), 'utf8')) as { pids: number[] }).pids;
  } catch {
    // No recorded services; nothing to stop.
  }

  const groups = process.platform !== 'win32';
  const send = (pid: number, signal: NodeJS.Signals) => {
    if (!pid) return;
    try {
      process.kill(groups ? -pid : pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        // gone
      }
    }
  };

  for (const pid of pids) send(pid, 'SIGTERM');
  // Give SIGTERM a moment, then make sure nothing lingers.
  await new Promise((r) => setTimeout(r, 700));
  for (const pid of pids) {
    send(pid, 'SIGKILL');
  }
  rmSync(join(__dirname, file), { force: true });
}
