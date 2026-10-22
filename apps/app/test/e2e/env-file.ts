import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

/**
 * Harness knobs (`E2E_*`, `TEST_REDIS_URL`, `APP_URL`/`APP_DEV_URL`) live in the
 * repo-root `.env.development` — the same file `npm run dev:build` reads — so a
 * machine sets `E2E_CONCURRENCY` once instead of prefixing every command. Shell
 * variables still win: this only fills in names that are unset.
 *
 * Only harness-owned names cross over. The file also carries master keys and DB
 * passwords, and harness children are spawned with `{ ...process.env }`, so
 * loading the whole file would hand production-shaped secrets to processes that
 * have no business holding them.
 */
const HARNESS_ENV = /^(E2E_[A-Z0-9_]+|TEST_REDIS_URL|APP_DEV_URL)$/;

function repoRoot(): string {
  return process.env.E2E_REPO_ROOT ?? join(__dirname, '..', '..', '..', '..');
}

export function loadHarnessEnv(root = repoRoot()): void {
  const file = join(root, '.env.development');
  if (!existsSync(file)) return;

  for (const [name, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (HARNESS_ENV.test(name) && process.env[name] === undefined) process.env[name] = value;
  }
}
