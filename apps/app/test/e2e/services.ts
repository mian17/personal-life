import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Spawn a long-lived Node process and wait until it reports ready.
 * Used by the Playwright global setup to bring up idp, note-service, and the
 * production-built app exactly as Docker would (same commands, same env).
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

export async function spawnService(options: SpawnOptions): Promise<SpawnedService> {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
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
      // eslint-disable-next-line no-console
      console.error(`[${options.name}] exited with code ${code}\n${logs.join('')}`);
    }
  });

  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        const t = setTimeout(() => {
          child.kill('SIGKILL');
          resolve(undefined);
        }, 3000);
        child.on('exit', () => {
          clearTimeout(t);
          resolve(undefined);
        });
      });
    }
  };

  return { name: options.name, child, stop };
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
