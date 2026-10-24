import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { testPorts } from './config';

/**
 * Cross-worktree slot queue. Concurrent e2e attempts on one machine take turns
 * through a single slot pool: an attempt claims a slot before it builds or binds
 * a port, holds it for the whole run, and hands it back at teardown. Queue state
 * is machine-scoped because worktree-local state cannot arbitrate between
 * worktrees.
 *
 * A worktree holds at most one slot at a time. Two stacks of the same worktree
 * would share its build output — each service's dist/ (built with
 * `deleteOutDir`) and `apps/app/.next` — so the second build deletes what the
 * first is running. Distinct slots isolate ports and containers, and cannot
 * isolate a shared directory, so the second attempt is refused instead of
 * handed slot 1.
 *
 * A waiting attempt parks a FIFO ticket (`<requestedAt>-<pid>.json`); a holder
 * parks a claim (`<slot>.hold.json`). Both are created exclusively, so the file
 * system picks the winner of any race. Claims and tickets of attempts that died
 * or outlived the run ceiling are reclaimed on sight.
 *
 * An attempt that cannot get a slot reports the queue instead of waiting: a
 * machine line (`E2E_QUEUE_BUSY` while a live holder blocks, `E2E_QUEUE_TIMEOUT`
 * when the acquire grace ran out) plus one line naming that holder and its
 * ports, then exit code 75 so a lane reads it as "retry later" instead of a
 * failed test run. `retryAfter` is measured: the queue position times the median
 * hold duration of the last few completed runs, falling back to a documented
 * constant on a machine that never completed one.
 */

/** Slots 0-8 keep every port inside its band, so the pool never grows past 9. */
const MAX_SLOT_COUNT = 9;
const DEFAULT_SLOT_COUNT = 1;
const DEFAULT_SLOT_MAX_AGE_MS = 1_800_000;
const DEFAULT_ACQUIRE_GRACE_MS = 30_000;
/**
 * How long one slot hold is assumed to take until this machine completed holds
 * to measure: five minutes covers a build, a stack boot and a full e2e run.
 */
const FALLBACK_HOLD_MS = 300_000;
/** Hold durations kept for the ETA median, oldest dropped first. */
const RECENT_HOLD_SAMPLES = 5;
/** Short pause between two looks at the queue, so a freed slot is picked up almost at once. */
const POLL_INTERVAL_MS = 50;
const HOLD_SUFFIX = '.hold.json';
const HOLD_DURATION_FILE = 'hold-durations.json';
const TICKET_NAME_ATTEMPTS = 100;
/** Stands in for the worktree field when no live attempt holds a slot. */
const NO_HOLDER = '-';

/** `EX_TEMPFAIL`: the lane's retry signal, never a test failure. */
export const RETRY_EXIT_CODE = 75;

export type SlotPorts = ReturnType<typeof testPorts>;

/** A slot this attempt holds, and the file that proves it. */
export type SlotClaim = {
  slot: number;
  pid: number;
  worktree: string;
  ports: SlotPorts;
  claimedAt: number;
  claimFile: string;
};

/** Either the slot this attempt won, or the reasons to come back later. */
export type SlotOutcome = { claim: SlotClaim } | { refusal: SlotRefusal };

/**
 * Which marker line the attempt prints: another worktree's holder blocks it, the
 * grace ran out, or this worktree already runs a stack.
 */
export type QueueMarker = 'E2E_QUEUE_BUSY' | 'E2E_QUEUE_TIMEOUT' | 'E2E_WORKTREE_BUSY';

/** What a queued-out attempt reports: who blocked it, where it stood, when to retry. */
export type SlotRefusal = {
  marker: QueueMarker;
  holderPid: number;
  holderWorktree: string;
  holderPorts?: SlotPorts;
  position: number;
  retryAfterSeconds: number;
};

/** On-disk claim: who holds a slot, with which ports, since when. */
type SlotHold = {
  pid: number;
  worktree: string;
  ports: SlotPorts;
  claimedAt: number;
};

/** On-disk ticket: who is waiting, and since when. */
type QueueTicket = {
  pid: number;
  worktree: string;
  requestedAt: number;
};

/** This attempt's place in the queue, and the slot pool it is waiting for. */
type QueueEntry = {
  directory: string;
  worktree: string;
  ticketFile: string;
};

/** One attempt's seat in line, and how long it may keep trying to reach a slot. */
type WaitingAttempt = {
  entry: QueueEntry;
  slotCount: number;
  deadline: number;
};

/** The queue as this attempt found it when it stopped waiting. */
type RefusalSource = {
  marker: QueueMarker;
  entry: QueueEntry;
  holder?: SlotHold;
};

/** Where the machine-wide queue keeps its claims and tickets. */
export function queueDirectory(): string {
  return process.env.E2E_QUEUE_DIR?.trim() || join(tmpdir(), 'life-e2e-slots');
}

/**
 * Claims the slot this run builds and boots in. When no slot frees up inside the
 * acquire grace, the attempt reports the queue and exits 75 instead of booting a
 * second stack beside a live holder.
 */
export function claimSlotForRun(worktree: string): SlotClaim {
  const outcome = attemptClaim(worktree);

  if ('claim' in outcome) return outcome.claim;
  exitForRefusal(outcome.refusal);
}

/**
 * Claims a slot for this attempt, waiting at most the acquire grace. The wait
 * ends at the first poll that wins a slot, at the first sign that a live holder
 * makes the wait pointless, or when the grace runs out.
 */
export function attemptClaim(worktree: string): SlotOutcome {
  const slotCount = concurrencyLimit();
  const deadline = Date.now() + acquireGraceMs();

  return withTicket(worktree, (entry) => waitForTurn({ entry, slotCount, deadline }));
}

/**
 * One look at the queue with no waiting: a claim when a slot is free for this
 * attempt right now, otherwise undefined.
 */
export function acquireSlot(worktree: string): SlotClaim | undefined {
  const slotCount = concurrencyLimit();
  return withTicket(worktree, (entry) => {
    if (worktreeHolder(entry.directory, entry.worktree)) return undefined;
    return claimWhenTurnArrives(entry, slotCount);
  });
}

/**
 * Hands the slot back and records how long the hold lasted, so the next attempt
 * retries on a measured ETA. Safe on a claim that was already reclaimed, so
 * teardown can release without checking first, and it never touches another
 * attempt's claim file.
 */
export function releaseSlot(claim: SlotClaim): void {
  if (!isStillHeldBy(claim)) return;

  rmSync(claim.claimFile, { force: true });
  recordHoldDuration(dirname(claim.claimFile), Date.now() - claim.claimedAt);
}

/** Prints the machine line a lane parses, then the one line a human reads. */
function printRefusal(refusal: SlotRefusal): void {
  console.log(markerLine(refusal));
  console.log(humanLine(refusal));
}

/** Reports the refusal and exits 75, which a lane reads as "busy, retry later". */
export function exitForRefusal(refusal: SlotRefusal): never {
  printRefusal(refusal);
  process.exit(RETRY_EXIT_CODE);
}

/**
 * Polls the queue until this attempt owns a slot, until a live holder makes
 * waiting pointless, or until its grace runs out.
 */
function waitForTurn(attempt: WaitingAttempt): SlotOutcome {
  for (;;) {
    reclaimAbandonedQueueFiles(attempt.entry.directory);

    const sameWorktree = worktreeHolder(attempt.entry.directory, attempt.entry.worktree);
    if (sameWorktree) return worktreeBusyRefusal(attempt.entry, sameWorktree);

    const claim = claimWhenTurnArrives(attempt.entry, attempt.slotCount);
    if (claim) return { claim };

    const holder = fullPoolHolder(attempt.entry.directory, attempt.slotCount);
    if (holder) return busyRefusal(attempt.entry, holder);
    if (Date.now() >= attempt.deadline) return timedOutRefusal(attempt.entry);

    pauseBetweenPolls();
  }
}

/** Claims a free slot, but only once every earlier waiter has been served. */
function claimWhenTurnArrives(entry: QueueEntry, slotCount: number): SlotClaim | undefined {
  if (!isFirstInLine(entry)) return undefined;
  return takeFreeSlot(entry, slotCount);
}

/** A freed slot is picked up on the next poll, but an idle attempt must not burn the machine. */
function pauseBetweenPolls(): void {
  // ponytail: a sync sleep keeps the claim API synchronous; switch to an await when an async caller exists.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, POLL_INTERVAL_MS);
}

/** How long an attempt keeps trying before it reports the queue as timed out. */
function acquireGraceMs(): number {
  const configured = Number(process.env.E2E_QUEUE_ACQUIRE_GRACE_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_ACQUIRE_GRACE_MS;
}

/** How many slots this machine may hand out, validated before any claim exists. */
function concurrencyLimit(): number {
  const configured = process.env.E2E_CONCURRENCY?.trim();
  if (!configured) return DEFAULT_SLOT_COUNT;

  const slotCount = Number(configured);
  if (!Number.isInteger(slotCount) || slotCount < 1 || slotCount > MAX_SLOT_COUNT) {
    throw new Error(
      `E2E_CONCURRENCY must be a whole number of slots 1-${MAX_SLOT_COUNT}, got "${configured}"`,
    );
  }

  return slotCount;
}

/** How long a claim may sit before it counts as abandoned. */
function slotMaxAgeMs(): number {
  const configured = Number(process.env.E2E_SLOT_MAX_AGE_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SLOT_MAX_AGE_MS;
}

/**
 * Joins the queue: this attempt gets a ticket of its own, attempts its turn, and
 * gives the ticket back however the attempt ends.
 */
function withTicket<Outcome>(worktree: string, attempt: (entry: QueueEntry) => Outcome): Outcome {
  const directory = queueDirectory();
  mkdirSync(directory, { recursive: true });
  reclaimAbandonedQueueFiles(directory);

  const entry = takeTicket(directory, worktree);
  try {
    return attempt(entry);
  } finally {
    rmSync(entry.ticketFile, { force: true });
  }
}

/**
 * Appends this attempt to the back of the queue. The arrival stamp in the file
 * name is what orders the queue, so sorting the names sorts the waiters.
 */
function takeTicket(directory: string, worktree: string): QueueEntry {
  const worktreePath = resolve(worktree);
  const requestedAt = Date.now();

  for (let offset = 0; offset < TICKET_NAME_ATTEMPTS; offset += 1) {
    const stamp = requestedAt + offset;
    const ticketFile = join(directory, `${stamp}-${process.pid}.json`);
    const ticket: QueueTicket = { pid: process.pid, worktree: worktreePath, requestedAt: stamp };
    if (writeNewFile(ticketFile, ticket)) return { directory, worktree: worktreePath, ticketFile };
  }

  throw new Error(`cannot take a queue ticket in ${directory}`);
}

/** Ticket names sort by arrival, so the lowest ticket name belongs to the head waiter. */
function isFirstInLine(entry: QueueEntry): boolean {
  const [head] = waitingTicketNames(entry.directory).sort((earlier, later) =>
    earlier.localeCompare(later),
  );
  return head === basename(entry.ticketFile);
}

/** Walks slots in index order and takes the first one no live attempt holds. */
function takeFreeSlot(entry: QueueEntry, slotCount: number): SlotClaim | undefined {
  for (let slot = 0; slot < slotCount; slot += 1) {
    const claim = claimSlot(entry, slot);
    if (claim) return claim;
  }

  return undefined;
}

function claimSlot(entry: QueueEntry, slot: number): SlotClaim | undefined {
  const claimFile = join(entry.directory, `${slot}${HOLD_SUFFIX}`);
  const hold: SlotHold = {
    pid: process.pid,
    worktree: entry.worktree,
    ports: testPorts(slot),
    claimedAt: Date.now(),
  };

  if (!writeNewFile(claimFile, hold)) return undefined;
  return { slot, ...hold, claimFile };
}

/**
 * Deletes the claims and tickets of attempts that are gone or wedged. Handling
 * both in one pass keeps a crashed attempt's dead claim from parking every later
 * attempt behind a dead ticket.
 */
function reclaimAbandonedQueueFiles(directory: string): void {
  const ceiling = slotMaxAgeMs();

  for (const fileName of [...holdFileNames(directory), ...waitingTicketNames(directory)]) {
    const file = join(directory, fileName);
    if (isAbandoned(readRecord(file), ceiling)) rmSync(file, { force: true });
  }
}

function isAbandoned(record: SlotHold | QueueTicket | undefined, ceiling: number): boolean {
  if (!record) return true;
  if (!isProcessAlive(record.pid)) return true;
  return Date.now() - arrivalTime(record) > ceiling;
}

function arrivalTime(record: SlotHold | QueueTicket): number {
  return 'claimedAt' in record ? record.claimedAt : record.requestedAt;
}

/** A dead pid (ESRCH) marks a crashed holder; EPERM marks one this user cannot signal. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Whether the claim file on disk is still the one this attempt wrote. */
function isStillHeldBy(claim: SlotClaim): boolean {
  return readRecord(claim.claimFile)?.pid === claim.pid;
}

function holdFileNames(directory: string): string[] {
  return readdirSync(directory).filter((fileName) => fileName.endsWith(HOLD_SUFFIX));
}

/** Tickets are named `<requestedAt>-<pid>.json`; anything else in the directory is not a waiter. */
function waitingTicketNames(directory: string): string[] {
  return readdirSync(directory).filter(isTicketFileName);
}

function isTicketFileName(fileName: string): boolean {
  return /^\d+-\d+\.json$/.test(fileName);
}

/** Claim files of attempts that are still alive and inside the run ceiling. */
function liveHolds(directory: string): SlotHold[] {
  const ceiling = slotMaxAgeMs();

  return holdFileNames(directory)
    .map((fileName) => readRecord(join(directory, fileName)))
    .filter(isHold)
    .filter((hold) => !isAbandoned(hold, ceiling));
}

/**
 * The claim this worktree already holds. A worktree has one build output, so a
 * second attempt in it cannot be given any slot — waiting for one would not help.
 */
function worktreeHolder(directory: string, worktree: string): SlotHold | undefined {
  const wanted = resolve(worktree);
  return liveHolds(directory).find((hold) => resolve(hold.worktree) === wanted);
}

/**
 * The holder that makes waiting pointless: with every slot taken, no freed slot
 * can reach this attempt before some holder finishes. A partly free pool is not
 * that case — the earlier waiters simply have not been served yet.
 */
function fullPoolHolder(directory: string, slotCount: number): SlotHold | undefined {
  const holders = liveHolds(directory);
  return holders.length < slotCount ? undefined : holders[0];
}

/** This attempt's place in line: live holders and earlier tickets come first, then it. */
function queuePosition(entry: QueueEntry): number {
  return 1 + liveHolds(entry.directory).length + countEarlierLiveTickets(entry);
}

function countEarlierLiveTickets(entry: QueueEntry): number {
  const ownTicket = basename(entry.ticketFile);
  const ceiling = slotMaxAgeMs();

  return waitingTicketNames(entry.directory)
    .filter((fileName) => fileName < ownTicket)
    .map((fileName) => readRecord(join(entry.directory, fileName)))
    .filter(isTicket)
    .filter((ticket) => !isAbandoned(ticket, ceiling)).length;
}

/** How long a hold takes on this machine: the median of the last completed ones. */
function slotHoldEtaMs(directory: string): number {
  const measured = recordedHoldDurations(directory);
  return measured.length > 0 ? median(measured) : FALLBACK_HOLD_MS;
}

function median(durations: number[]): number {
  const sorted = [...durations].sort((earlier, later) => earlier - later);
  const middle = Math.floor(sorted.length / 2);
  const isOddCount = sorted.length % 2 === 1;

  return isOddCount ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function recordedHoldDurations(directory: string): number[] {
  try {
    const recorded: unknown = JSON.parse(readFileSync(join(directory, HOLD_DURATION_FILE), 'utf8'));
    return Array.isArray(recorded) ? recorded.filter(isHoldDuration) : [];
  } catch {
    return [];
  }
}

function isHoldDuration(value: unknown): value is number {
  return typeof value === 'number' && value >= 0;
}

function recordHoldDuration(directory: string, heldMs: number): void {
  const recorded = [...recordedHoldDurations(directory), heldMs];
  writeFileSync(
    join(directory, HOLD_DURATION_FILE),
    JSON.stringify(recorded.slice(-RECENT_HOLD_SAMPLES)),
  );
}

function busyRefusal(entry: QueueEntry, holder: SlotHold): SlotOutcome {
  return { refusal: refusalFrom({ marker: 'E2E_QUEUE_BUSY', entry, holder }) };
}

function timedOutRefusal(entry: QueueEntry): SlotOutcome {
  return { refusal: refusalFrom({ marker: 'E2E_QUEUE_TIMEOUT', entry }) };
}

function worktreeBusyRefusal(entry: QueueEntry, holder: SlotHold): SlotOutcome {
  return { refusal: refusalFrom({ marker: 'E2E_WORKTREE_BUSY', entry, holder }) };
}

function refusalFrom(source: RefusalSource): SlotRefusal {
  const position = queuePosition(source.entry);

  return {
    marker: source.marker,
    holderPid: source.holder?.pid ?? 0,
    holderWorktree: source.holder?.worktree ?? NO_HOLDER,
    holderPorts: source.holder?.ports,
    position,
    retryAfterSeconds: Math.round((position * slotHoldEtaMs(source.entry.directory)) / 1000),
  };
}

/** The line a lane parses: four fields, marker first. */
function markerLine(refusal: SlotRefusal): string {
  return [
    refusal.marker,
    `holder=${refusal.holderPid}`,
    `worktree=${refusal.holderWorktree}`,
    `position=${refusal.position}`,
    `retryAfter=${refusal.retryAfterSeconds}`,
  ].join(' ');
}

/** The one line a human reads: who holds the slot, on which ports, and when to retry. */
function humanLine(refusal: SlotRefusal): string {
  const retry = `retry in about ${refusal.retryAfterSeconds}s`;

  if (refusal.marker === 'E2E_WORKTREE_BUSY') {
    const where = refusal.holderPorts ? ` on ${describePorts(refusal.holderPorts)}` : '';
    return `e2e queue: this worktree already runs a stack (pid ${refusal.holderPid})${where} — one stack per worktree, so wait for it or use another worktree`;
  }

  const ports = refusal.holderPorts;

  if (!ports) {
    return `e2e queue: no live holder, ${refusal.position} attempt(s) ahead in line — ${retry}`;
  }

  return `e2e queue: pid ${refusal.holderPid} runs the stack in ${refusal.holderWorktree} on ${describePorts(ports)} — ${retry}`;
}

function describePorts(ports: SlotPorts): string {
  return Object.entries(ports)
    .map(([name, port]) => `${name} ${port}`)
    .join(', ');
}

function readRecord(file: string): SlotHold | QueueTicket | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as SlotHold | QueueTicket;
  } catch {
    return undefined;
  }
}

function isHold(record: SlotHold | QueueTicket | undefined): record is SlotHold {
  return record !== undefined && 'claimedAt' in record;
}

function isTicket(record: SlotHold | QueueTicket | undefined): record is QueueTicket {
  return record !== undefined && 'requestedAt' in record;
}

/** Writes `content` as JSON into a brand-new file; false when another attempt owns it. */
function writeNewFile(file: string, content: unknown): boolean {
  try {
    writeFileSync(file, JSON.stringify(content), { flag: 'wx' });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}
