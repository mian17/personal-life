/**
 * CLI bootstrap suite (SPEC.md §3): service resolution is lazy, so `login` and
 * `logout` never read `LIFE_OPS_SERVICE` while a `call` still fails on a missing
 * or unknown selector exactly as before. The loader is wrapped to count resolves;
 * no test contacts a real service or IdP.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadService, main } from '../src/cli/run';

interface Outcome {
  exit: number;
  stdout: string[];
  stderr: string[];
  /** How often the run asked for the service module. */
  resolutions: number;
}

/** Mirrors the `bin` runner: `main` gets the loader, and loading is what we count. */
async function runCli(argv: string[], env: NodeJS.ProcessEnv): Promise<Outcome> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const outcome: Outcome = { exit: 0, stdout, stderr, resolutions: 0 };
  outcome.exit = await main({
    argv,
    service: async () => {
      outcome.resolutions += 1;
      return await loadService(env);
    },
    env,
    stdout: (line) => {
      stdout.push(line);
    },
    stderr: (line) => {
      stderr.push(line);
    },
    signIn: async () => {},
  });
  return outcome;
}

describe('main service resolution', () => {
  let credentialsFile = '';
  let savedCredentialsPath: string | undefined;

  beforeEach(() => {
    credentialsFile = join(mkdtempSync(join(tmpdir(), 'life-ops-cli-bootstrap-')), 'credentials.json');
    savedCredentialsPath = process.env.LIFE_OPS_CREDENTIALS_PATH;
    process.env.LIFE_OPS_CREDENTIALS_PATH = credentialsFile;
  });

  afterEach(() => {
    if (savedCredentialsPath === undefined) delete process.env.LIFE_OPS_CREDENTIALS_PATH;
    else process.env.LIFE_OPS_CREDENTIALS_PATH = savedCredentialsPath;
    rmSync(dirname(credentialsFile), { recursive: true, force: true });
  });

  it('logs in with no LIFE_OPS_SERVICE set and never resolves a service', async () => {
    const outcome = await runCli(['login'], {});

    expect(outcome.exit).toBe(0);
    expect(outcome.stdout).toEqual(['logged in']);
    expect(outcome.stderr).toEqual([]);
    expect(outcome.resolutions).toBe(0);
  });

  it('logs out with no LIFE_OPS_SERVICE set and never resolves a service', async () => {
    const outcome = await runCli(['logout'], {});

    expect(outcome.exit).toBe(0);
    expect(outcome.stdout).toEqual(['logged out']);
    expect(outcome.stderr).toEqual([]);
    expect(outcome.resolutions).toBe(0);
  });

  it('still fails a call for want of a selector, and says so on stderr', async () => {
    const outcome = await runCli(['notes', 'list'], {});

    expect(outcome.exit).toBe(1);
    expect(outcome.stderr).toEqual(['LIFE_OPS_SERVICE is not set; point it at a registry module']);
    expect(outcome.resolutions).toBe(1);
  });

  it('still names an unknown service instead of importing it', async () => {
    const outcome = await runCli(['notes', 'list'], { LIFE_OPS_SERVICE: 'tags' });

    expect(outcome.exit).toBe(1);
    expect(outcome.stderr).toEqual(['LIFE_OPS_SERVICE names unknown service tags; known services: notes']);
  });
});
