import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testPorts } from './e2e/config';
import {
  acquireSlot,
  attemptClaim,
  claimSlotForRun,
  queueDirectory,
  releaseSlot,
} from './e2e/slot-queue';

const WORKTREE = '/tmp/worktree-under-test';
const RUN_CEILING_MS = 60_000;
const SLOT_ZERO_CLAIM = '0.hold.json';
const HOLD_DURATION_FILE = 'hold-durations.json';
/** The documented fallback ETA, in seconds, of a machine that completed no hold yet. */
const FALLBACK_RETRY_SECONDS = 300;
/** "Well under a second" for an attempt that finds a live holder: one poll, no sleep. */
const BUSY_RETURN_LIMIT_MS = 250;

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'slot-queue-'));
  process.env.E2E_QUEUE_DIR = directory;
  process.env.E2E_SLOT_MAX_AGE_MS = String(RUN_CEILING_MS);
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  delete process.env.E2E_QUEUE_DIR;
  delete process.env.E2E_CONCURRENCY;
  delete process.env.E2E_SLOT_MAX_AGE_MS;
  delete process.env.E2E_QUEUE_ACQUIRE_GRACE_MS;
});

/** A pid that has already exited, so `process.kill(pid, 0)` reports it dead. */
function deadPid(): number {
  return spawnSync(process.execPath, ['-e', '']).pid as number;
}

/** The exit a reported refusal asks for, thrown so the suite can observe it. */
class QueueExit extends Error {}

/** Runs one attempt that is expected to give up, and reports what a lane would see. */
function reportOf(worktree: string): { exitCode: number; lines: string[] } {
  const lines: string[] = [];
  const exitCodes: number[] = [];
  const log = jest.spyOn(console, 'log').mockImplementation((line: string) => {
    lines.push(line);
  });
  const exit = jest.spyOn(process, 'exit').mockImplementation(((exitCode: number) => {
    exitCodes.push(exitCode);
    throw new QueueExit(`attempt exited ${exitCode}`);
  }) as never);

  try {
    claimSlotForRun(worktree);
  } catch (error) {
    if (!(error instanceof QueueExit)) throw error;
  } finally {
    log.mockRestore();
    exit.mockRestore();
  }

  if (exitCodes.length !== 1) throw new Error('the attempt did not report the queue and exit');
  return { exitCode: exitCodes[0], lines };
}

function claimFileName(slot: number): string {
  return join(directory, `${slot}.hold.json`);
}

function writeHold(slot: number, pid: number, claimedAt = Date.now()): void {
  const hold = { pid, worktree: WORKTREE, ports: testPorts(slot), claimedAt };
  writeFileSync(claimFileName(slot), JSON.stringify(hold));
}

function writeTicket(requestedAt: number): string {
  const fileName = `${requestedAt}-${process.pid}.json`;
  const ticket = { pid: process.pid, worktree: WORKTREE, requestedAt };
  writeFileSync(join(directory, fileName), JSON.stringify(ticket));
  return fileName;
}

function hasSlotZeroClaim(): boolean {
  return readdirSync(directory).includes(SLOT_ZERO_CLAIM);
}

describe('claiming a slot', () => {
  it('claims slot 0 with the pid, worktree and ports of the attempt', () => {
    const claimedAt = Date.now();
    const claim = acquireSlot(WORKTREE);

    expect(claim).toMatchObject({
      slot: 0,
      pid: process.pid,
      worktree: WORKTREE,
      ports: testPorts(0),
    });
    expect(claim?.claimedAt).toBeGreaterThanOrEqual(claimedAt);
    expect(JSON.parse(readFileSync(claimFileName(0), 'utf8'))).toMatchObject({ pid: process.pid });
  });

  it('leaves a live holder claim untouched', () => {
    writeHold(0, process.pid);
    const before = readFileSync(claimFileName(0), 'utf8');

    expect(acquireSlot(WORKTREE)).toBeUndefined();
    expect(readFileSync(claimFileName(0), 'utf8')).toBe(before);
  });

  it('takes the slot of a holder whose pid is dead', () => {
    writeHold(0, deadPid());

    expect(acquireSlot(WORKTREE)).toMatchObject({ slot: 0, pid: process.pid });
  });

  it('takes the slot of a claim older than the run ceiling', () => {
    writeHold(0, process.pid, Date.now() - RUN_CEILING_MS - 1);

    expect(acquireSlot(WORKTREE)).toMatchObject({ slot: 0 });
  });

  it('walks to the next slot while a live attempt holds slot 0', () => {
    process.env.E2E_CONCURRENCY = '2';
    writeHold(0, process.pid);

    expect(acquireSlot(WORKTREE)).toMatchObject({ slot: 1, ports: testPorts(1) });
  });

  it('stops at the configured slot count', () => {
    process.env.E2E_CONCURRENCY = '1';
    writeHold(0, process.pid);

    expect(acquireSlot(WORKTREE)).toBeUndefined();
  });

  it('removes the claim file it wrote when released', () => {
    const claim = acquireSlot(WORKTREE);

    releaseSlot(claim!);
    expect(readdirSync(directory)).toEqual([HOLD_DURATION_FILE]);
  });

  it('leaves a claim that another attempt took over in the meantime', () => {
    const claim = acquireSlot(WORKTREE);
    writeHold(0, deadPid());

    releaseSlot(claim!);
    expect(hasSlotZeroClaim()).toBe(true);
  });
});

describe('reporting the queue', () => {
  it('reports the live holder, its ports and a fallback retry instead of waiting', () => {
    writeHold(0, process.pid);

    const startedAt = Date.now();
    const outcome = attemptClaim(WORKTREE);

    expect(Date.now() - startedAt).toBeLessThan(BUSY_RETURN_LIMIT_MS);
    expect(outcome).toEqual({
      refusal: {
        marker: 'E2E_QUEUE_BUSY',
        holderPid: process.pid,
        holderWorktree: WORKTREE,
        holderPorts: testPorts(0),
        position: 2,
        retryAfterSeconds: 2 * FALLBACK_RETRY_SECONDS,
      },
    });
  });

  it('counts the holders and the earlier waiters into the queue position', () => {
    writeHold(0, process.pid);
    writeTicket(Date.now() - 5);

    expect(attemptClaim(WORKTREE)).toMatchObject({ refusal: { position: 3, retryAfterSeconds: 900 } });
  });

  it('prints one busy marker line and one human line naming the holder, then exits 75', () => {
    writeHold(0, process.pid);

    const { exitCode, lines } = reportOf(WORKTREE);

    expect(exitCode).toBe(75);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^E2E_QUEUE_BUSY holder=\d+ worktree=\S+ position=\d+ retryAfter=\d+$/);
    expect(lines[1]).toContain(`pid ${process.pid}`);
    expect(lines[1]).toContain(String(testPorts(0).appPort));
  });

  it('prints one timeout marker line and one human line once the grace runs out, then exits 75', () => {
    process.env.E2E_QUEUE_ACQUIRE_GRACE_MS = '0';
    writeTicket(Date.now() - 5);

    const { exitCode, lines } = reportOf(WORKTREE);

    expect(exitCode).toBe(75);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^E2E_QUEUE_TIMEOUT holder=\S+ worktree=\S+ position=\d+ retryAfter=\d+$/);
    expect(lines[1]).toContain('attempt(s) ahead in line');
  });

  it('records the completed hold and retries on that measured median', () => {
    completeHolds([1_000, 2_000, 3_000, 4_000, 5_000, 6_000]);
    writeHold(0, process.pid);

    expect(attemptClaim(WORKTREE)).toMatchObject({ refusal: { position: 2, retryAfterSeconds: 8 } });

    const recorded = readHoldDurations();
    expect(recorded).toHaveLength(5);
    recorded.forEach((heldMs, index) =>
      expect(Math.abs(heldMs - (2_000 + index * 1_000))).toBeLessThan(50),
    );
  });

  it('claims once the holder is gone, instead of reporting it', () => {
    writeHold(0, deadPid());

    expect(attemptClaim(WORKTREE)).toMatchObject({ claim: { slot: 0 } });
  });

  /** Claims and releases a slot once per duration, each hold backdated to that length. */
  function completeHolds(heldTimesMs: number[]): void {
    for (const heldMs of heldTimesMs) {
      const claim = acquireSlot(WORKTREE)!;
      releaseSlot({ ...claim, claimedAt: claim.claimedAt - heldMs });
    }
  }

  function readHoldDurations(): number[] {
    return JSON.parse(readFileSync(join(directory, HOLD_DURATION_FILE), 'utf8'));
  }
});

describe('waiting in line', () => {
  it('waits behind an earlier ticket even while the slot is free', () => {
    writeTicket(Date.now() - 5);

    expect(acquireSlot(WORKTREE)).toBeUndefined();
    expect(hasSlotZeroClaim()).toBe(false);
  });

  it('claims ahead of a ticket that arrived later', () => {
    writeTicket(Date.now() + 5_000);

    expect(acquireSlot(WORKTREE)).toMatchObject({ slot: 0 });
  });

  it('removes its own ticket once it stops waiting', () => {
    const earlierTicket = writeTicket(Date.now() - 5);

    acquireSlot(WORKTREE);

    expect(readdirSync(directory)).toEqual([earlierTicket]);
  });

  it('reclaims the ticket of an attempt that died while waiting', () => {
    const requestedAt = Date.now() - 5;
    const pid = deadPid();
    const ticket = { pid, worktree: WORKTREE, requestedAt };
    writeFileSync(join(directory, `${requestedAt}-${pid}.json`), JSON.stringify(ticket));

    expect(acquireSlot(WORKTREE)).toMatchObject({ slot: 0 });
  });
});

describe('queue configuration', () => {
  it('rejects more slots than the port bands hold, before creating any state', () => {
    process.env.E2E_CONCURRENCY = '10';

    expect(() => acquireSlot(WORKTREE)).toThrow(/E2E_CONCURRENCY/);
    expect(readdirSync(directory)).toEqual([]);
  });

  it.each(['0', 'two', '1.5'])('rejects the concurrency setting %s', (configured) => {
    process.env.E2E_CONCURRENCY = configured;

    expect(() => acquireSlot(WORKTREE)).toThrow(/E2E_CONCURRENCY/);
  });

  it('defaults the queue directory to the machine temp dir, outside the worktree', () => {
    delete process.env.E2E_QUEUE_DIR;

    expect(queueDirectory()).toBe(join(tmpdir(), 'life-e2e-slots'));
    expect(queueDirectory().startsWith(process.cwd())).toBe(false);
  });

  it('honours E2E_QUEUE_DIR over the machine temp dir', () => {
    expect(queueDirectory()).toBe(directory);
  });
});
