#!/usr/bin/env node
/**
 * The `life-ops` bin entry: the process wiring the tested adapter in `run.ts`
 * deliberately does not own. It supplies the real argv, environment, streams, and
 * IdP login, and turns a run that still throws into an exit code.
 *
 * No test imports this file — `test/cli-bootstrap.test.ts` mirrors the same wiring
 * against `main` directly — so it may use `import.meta`, which the suite's
 * CommonJS transform does not allow.
 */
import { pathToFileURL } from 'node:url';
import { login } from '../auth/login.js';
import { renderFailure } from './render.js';
import { loadService, main } from './run.js';

const FAILURE_EXIT = 1;

/** Read the environment, hand service loading to the adapter, dispatch, exit. */
async function runBin(): Promise<void> {
  try {
    process.exitCode = await main({
      argv: process.argv.slice(2),
      service: () => loadService(process.env),
      env: process.env,
      stdout: (line) => process.stdout.write(`${line}\n`),
      stderr: (line) => process.stderr.write(`${line}\n`),
      signIn: async () => {
        await login();
      },
    });
  } catch (error) {
    process.stderr.write(`${renderFailure(error)}\n`);
    process.exitCode = FAILURE_EXIT;
  }
}

/**
 * Run only when Node was told to execute this file: ESM has no `require.main`, and
 * `import.meta.main` is Node 24+, so compare the entry path. `argv[1]` is absent under
 * `node -e`, where this module can only ever be imported, never executed.
 */
function startedAsEntry(): boolean {
  const entryPath = process.argv[1];
  return entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href;
}

if (startedAsEntry()) await runBin();
