import { execFile } from 'child_process';

import { existsSync, rmSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { promisify } from 'util';
import { isProductionDbPath, resolveDbPath } from '../src/config/db-path.js';

/**
 * Seed environment-safety e2e (2026-09-25). Proves the seed script's DB targeting
 * and refusal gate without ever touching the production identity DB. `DB_PATH`
 * for these tests always points at scratch files under test/.
 */

const FIXTURE_PASSWORD = 'fixture-password-not-a-secret';
const IDP_ROOT = join(import.meta.dirname, '..');

const SEED_SCRIPT = join(IDP_ROOT, 'scripts', 'seed-user.ts');
/** ts-node 10 predates Node's ESM detection, so the CJS bin cannot load these
 * ESM scripts; the ESM loader plus a cwd of apps/idp (which selects its
 * NodeNext tsconfig) is what runs them. */
const TS_NODE_ESM_LOADER_ARGS = ['--loader', 'ts-node/esm'];
const execFileAsync = promisify(execFile);

/**
 * Runs the real seed script as a subprocess. `NODE_ENV`, `DB_PATH`, `KEYS_PATH`,
 * `SEED_USERNAME`, `SEED_PASSWORD` are fully controlled by the caller — any
 * ambient value in the parent process is removed first so a sibling suite can
 * never leak into an assertion.
 */
async function runSeed(
  overrides: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ['NODE_ENV', 'DB_PATH', 'KEYS_PATH', 'SEED_USERNAME', 'SEED_PASSWORD']) {
    delete env[key];
  }
  Object.assign(env, overrides);
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [...TS_NODE_ESM_LOADER_ARGS, SEED_SCRIPT],
      {
        cwd: IDP_ROOT,
        env,
      },
    );
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

const SCRATCH_DEFAULT = join(IDP_ROOT, 'data', 'scratch.db');
const PROD_DB = join(IDP_ROOT, 'data', 'idp.db');

describe('Seed DB targeting (e2e)', () => {
  beforeAll(() => {
    // Never let a stray scratch file from a prior run influence an assertion.
    rmSync(SCRATCH_DEFAULT, { force: true });
  });

  afterAll(() => {
    rmSync(SCRATCH_DEFAULT, { force: true });
  });

  // Each test spawns a ts-node ESM loader child; 90s keeps that cost off the timeout.
  it('non-prod + no DB_PATH seeds the scratch DB (NODE_ENV unset)', async () => {
    rmSync(SCRATCH_DEFAULT, { force: true });
    const res = await runSeed({
      SEED_USERNAME: 'scratch-default',
      SEED_PASSWORD: FIXTURE_PASSWORD,
    });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('[seed:test] seeding test DB:');
    expect(res.stdout).toContain(join(IDP_ROOT, 'data', 'scratch.db'));
    expect(existsSync(SCRATCH_DEFAULT)).toBe(true);
  }, 90000);

  it('non-prod + DB_PATH pointing at the production DB refuses before any write', async () => {
    const before = existsSync(PROD_DB) ? statSync(PROD_DB).size : -1;

    for (const prodCandidate of [PROD_DB, join('data', 'idp.db'), './data/idp.db']) {
      const res = await runSeed({
        NODE_ENV: 'test',
        SEED_USERNAME: 'should-refuse',
        SEED_PASSWORD: FIXTURE_PASSWORD,
        DB_PATH: prodCandidate,
      });
      expect(res.code).not.toBe(0);
      expect(res.stderr).toContain('without NODE_ENV=production');
    }

    // The production DB is untouched: same existence and size as before.
    const after = existsSync(PROD_DB) ? statSync(PROD_DB).size : -1;
    expect(after).toBe(before);
  }, 90000);

  it('non-prod + a scratch DB_PATH seeds normally', async () => {
    const scratch = join(import.meta.dirname, 'test-seed-env-scratch.db');
    rmSync(scratch, { force: true });
    try {
      const res = await runSeed({
        NODE_ENV: 'test',
        SEED_USERNAME: 'scratch-explicit',
        SEED_PASSWORD: FIXTURE_PASSWORD,
        DB_PATH: scratch,
      });
      expect(res.code).toBe(0);
      expect(res.stdout).toContain('[seed:test] seeding test DB:');
      expect(existsSync(scratch)).toBe(true);
    } finally {
      rmSync(scratch, { force: true });
    }
  }, 90000);

  it('NODE_ENV=production + a scratch DB_PATH seeds and announces production mode', async () => {
    const scratch = join(import.meta.dirname, 'test-seed-env-prod.db');
    rmSync(scratch, { force: true });
    try {
      const res = await runSeed({
        NODE_ENV: 'production',
        SEED_USERNAME: 'prod-mode',
        SEED_PASSWORD: FIXTURE_PASSWORD,
        DB_PATH: scratch,
      });
      expect(res.code).toBe(0);
      expect(res.stdout).toContain('[seed:production] seeding PRODUCTION identity DB:');
      expect(existsSync(scratch)).toBe(true);
    } finally {
      rmSync(scratch, { force: true });
    }
  }, 90000);

  it('NODE_ENV=production with NO credentials set refuses (never defaults prod creds)', async () => {
    const scratch = join(import.meta.dirname, 'test-seed-env-nocreds.db');
    rmSync(scratch, { force: true });
    try {
      const res = await runSeed({ NODE_ENV: 'production', DB_PATH: scratch });
      expect(res.code).not.toBe(0);
      expect(res.stderr).toContain('SEED_USERNAME and SEED_PASSWORD must both be set');
      expect(existsSync(scratch)).toBe(false);
    } finally {
      rmSync(scratch, { force: true });
    }
  }, 90000);

  it('non-production with NO credentials seeds the default dev user', async () => {
    const scratch = join(import.meta.dirname, 'test-seed-env-devdefault.db');
    rmSync(scratch, { force: true });
    try {
      const res = await runSeed({ NODE_ENV: 'test', DB_PATH: scratch });
      expect(res.code).toBe(0);
      expect(res.stdout).toContain('user "dev"');
      expect(existsSync(scratch)).toBe(true);
    } finally {
      rmSync(scratch, { force: true });
    }
  }, 90000);
});

describe('DB path resolver', () => {
  it('defaults to the production DB only under NODE_ENV=production', () => {
    expect(resolveDbPath({ NODE_ENV: 'production' })).toBe(join(process.cwd(), 'data', 'idp.db'));
  });

  it('defaults everything else to the scratch DB', () => {
    for (const nodeEnv of ['development', 'test', undefined]) {
      expect(resolveDbPath({ NODE_ENV: nodeEnv })).toBe(join(process.cwd(), 'data', 'scratch.db'));
    }
  });

  it('lets an explicit DB_PATH win in every mode', () => {
    expect(resolveDbPath({ NODE_ENV: 'production', DB_PATH: '/x/p.db' })).toBe('/x/p.db');
    expect(resolveDbPath({ NODE_ENV: 'test', DB_PATH: '/x/s.db' })).toBe('/x/s.db');
  });

  it('recognizes the production DB across path spellings', () => {
    expect(isProductionDbPath(join(process.cwd(), 'data', 'idp.db'))).toBe(true);
    expect(isProductionDbPath(join(process.cwd(), 'data', '..', 'data', 'idp.db'))).toBe(true);
    // A DB outside the `data/` directory is not the production DB, wherever it lives.
    expect(isProductionDbPath(join(process.cwd(), 'elsewhere', 'idp.db'))).toBe(false);
    expect(isProductionDbPath(join(process.cwd(), 'data', 'scratch.db'))).toBe(false);
  });
});
