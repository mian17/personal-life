import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

/**
 * Spawn a long-lived Node process and wait until it reports ready.
 * Used by the Playwright global setup to bring up idp, note-service, and the app
 * exactly as Docker (or `next dev`) would.
 *
 * The child is spawned in its own process group (`detached` on POSIX) so teardown
 * can kill the whole tree: `next dev` forks a `next-server` child that would
 * otherwise outlive a SIGTERM to the launcher.
 */
export interface SpawnedService {
  name: string;
  child: ChildProcess;
  stop: () => Promise<void>;
}

export interface SpawnOptions {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

const SUPPORTS_GROUPS = process.platform !== 'win32';

function signalTree(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return;
  try {
    // Negative pid targets the whole process group created by `detached`.
    process.kill(SUPPORTS_GROUPS ? -pid : pid, signal);
  } catch {
    // Already gone, or no group (best-effort).
    try {
      process.kill(pid, signal);
    } catch {
      // gone
    }
  }
}

export async function spawnService(options: SpawnOptions): Promise<SpawnedService> {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: SUPPORTS_GROUPS,
  });

  const logs: string[] = [];
  const capture = (chunk: Buffer) => {
    logs.push(chunk.toString());
    if (logs.length > 200) logs.shift();
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      // Surface the tail; e2e failures are otherwise opaque.
      console.error(`[${options.name}] exited with code ${code}\n${logs.join('')}`);
    }
  });

  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) {
      signalTree(child.pid, 'SIGKILL');
      return;
    }
    signalTree(child.pid, 'SIGTERM');
    await new Promise((resolve) => {
      const t = setTimeout(() => {
        signalTree(child.pid, 'SIGKILL');
        resolve(undefined);
      }, 3000);
      child.on('exit', () => {
        clearTimeout(t);
        resolve(undefined);
      });
    });
    // Belt-and-braces: reap the group again in case a grandchild survived.
    signalTree(child.pid, 'SIGKILL');
  };

  return { name: options.name, child, stop };
}

/**
 * Assert nothing is already bound to `port`. A stale listener is the one harness
 * failure that silently produces a WRONG result instead of an error: the fresh
 * server dies with EADDRINUSE, `waitForHttp` then answers against the stale
 * process, and the run tests a build whose chunk hashes are already gone from
 * disk (ChunkLoadError on the page — never a product bug). Failing here keeps
 * that failure loud and at setup, where it belongs.
 */
export async function ensurePortFree(port: number, name: string, host = '127.0.0.1'): Promise<void> {
  const taken = await new Promise<boolean>((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(true));
    probe.once('listening', () => probe.close(() => resolve(false)));
    probe.listen(port, host);
  });
  if (taken) {
    throw new Error(
      `e2e port ${port} (${name}) is already in use — stop the stale stack before running e2e`,
    );
  }
}

/** Poll a URL until it answers or the deadline passes. */
export async function waitForHttp(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'unknown';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status < 500) return;
      lastError = `status ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`service not ready at ${url}: ${lastError}`);
}
