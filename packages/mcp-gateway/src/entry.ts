#!/usr/bin/env node
/**
 * The `mcp-gateway` stdio entry: the process wiring the tested server in `server.ts` deliberately
 * does not own. It reads the published package version the handshake reports — the one place
 * `package.json` is read, because reading it needs either `require` (not defined once this package
 * is ESM) or `import.meta` (illegal in `server.ts`, which the suites import under a CommonJS
 * transform) — then runs the one loop until stdin closes.
 *
 * No test imports this file: `test/*.test.ts` drive `createMcpServer` directly, and
 * `test/gateway-conformance.test.ts` spawns it as a real child process instead.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { main } from './server.js';

const SERVER_VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

/** The stdio entry: the environment's config, the process writers, the package version, then the loop. */
async function serveFromEnvironment(): Promise<void> {
  process.exitCode = await main({
    env: process.env,
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
    version: SERVER_VERSION,
  });
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
