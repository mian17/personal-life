import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { basename } from 'node:path';
import { artifactsRoot, pidsFilePath, repoRoot } from './config';
import { releaseSlot, type SlotClaim } from './slot-queue';

/**
 * Reads a recorded PID file and stops each service's whole process group.
 * Services are spawned detached (see services.ts), so the negative pid kills
 * `next dev`'s forked `next-server` child too.
 */
export async function stopRecorded(file: string): Promise<void> {
  let pids: number[] = [];
  try {
    pids = (JSON.parse(readFileSync(pidsFilePath(file), 'utf8')) as { pids: number[] }).pids;
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
  rmSync(pidsFilePath(file), { force: true });
}

/**
 * Writes the claim down. Setup, teardown and the specs run as separate modules
 * in separate processes, and a setup that aborts skips its own teardown, so the
 * claim has to live somewhere all three can read rather than in memory.
 */
export function recordHeldSlot(claim: SlotClaim): void {
  writeFileSync(heldSlotFile(), JSON.stringify(claim));
}

/** The slot this run holds; 0 when a spec runs without the harness setup. */
export function heldSlot(): number {
  return heldClaim()?.slot ?? 0;
}

/**
 * Hands the slot back, best-effort: a run that never claimed, and a claim the
 * queue already reclaimed because its holder died, are both nothing to report.
 * Both entry points call it from a `finally`, so an aborted setup releases too.
 */
export function releaseHeldSlot(): void {
  const claim = heldClaim();
  if (!claim) return;

  releaseSlot(claim);
  rmSync(heldSlotFile(), { force: true });
}

/** One harness runs at a time per worktree, so one record file serves them all. */
function heldSlotFile(): string {
  return join(artifactsRoot(), `${basename(repoRoot())}-service-slot.json`);
}

function heldClaim(): SlotClaim | undefined {
  try {
    return JSON.parse(readFileSync(heldSlotFile(), 'utf8')) as SlotClaim;
  } catch {
    return undefined;
  }
}
