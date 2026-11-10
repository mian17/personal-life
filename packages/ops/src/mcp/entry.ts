#!/usr/bin/env node
/**
 * The MCP stdio entry: the process wiring the tested server in `server.ts`
 * deliberately does not own. It reads the service modules `LIFE_OPS_SERVICE`
 * names, passes the published package version the handshake reports, and runs the
 * one loop until stdin closes.
 *
 * No test imports this file — `test/mcp-lifecycle.test.ts` drives `createMcpServer`
 * directly — so it may use `import.meta`, which the suite's CommonJS transform does
 * not allow. `test/sdk-client.test.ts` spawns it as a real child process instead.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadService } from '../cli/run.js';
import { renderFailure } from '../cli/render.js';
import { main } from './server.js';

const FAILURE_EXIT = 1;

/** `serverInfo.version`: the published package version this file is part of. */
const SERVER_VERSION = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

/** The stdio entry: the service modules named by `LIFE_OPS_SERVICE`, then the loop. */
async function serveFromEnvironment(): Promise<void> {
  try {
    const service = await loadService(process.env);
    process.exitCode = await main({
      registry: service.resources ?? service.registry,
      modules: service.modules,
      apiBase: service.apiBase,
      serverVersion: SERVER_VERSION,
      env: process.env,
      stdout: (line) => process.stdout.write(`${line}\n`),
      stderr: (line) => process.stderr.write(`${line}\n`),
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

if (startedAsEntry()) await serveFromEnvironment();
