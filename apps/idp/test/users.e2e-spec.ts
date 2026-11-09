import { INestApplication } from '@nestjs/common';

import * as argon2 from 'argon2';
import Database from 'better-sqlite3';
import { execFile } from 'child_process';
import { readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { UsersService } from '../src/users/users.service.js';

const FIXTURE_PASSWORD = 'fixture-password-not-a-secret';

const SEED_SCRIPT = join(__dirname, '..', 'scripts', 'seed-user.ts');
/** ts-node 10 predates Node's ESM detection, so the CJS bin cannot load these
 * ESM scripts; the ESM loader plus a cwd of apps/idp (which selects its
 * NodeNext tsconfig) is what runs them. */
const TS_NODE_ESM_LOADER_ARGS = ['--loader', 'ts-node/esm'];
const execFileAsync = promisify(execFile);

async function runSeed(
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [...TS_NODE_ESM_LOADER_ARGS, SEED_SCRIPT],
      {
        cwd: join(__dirname, '..'),
        env: { ...process.env, ...env },
      },
    );
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('Users credentials (e2e)', () => {
  const TEST_DB = join(__dirname, 'test-idp-users.db');
  const TEST_KEYS = join(__dirname, 'test-idp-users-keys.json');
  process.env.DB_PATH = TEST_DB;
  process.env.KEYS_PATH = TEST_KEYS;

  let app: INestApplication;
  let users: UsersService;

  beforeAll(async () => {
    rmSync(TEST_DB, { force: true });
    rmSync(TEST_KEYS, { force: true });
    const { createApp } = await import('../src/app.factory.js');
    app = await createApp();
    await app.init();
    users = app.get(UsersService);
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    rmSync(TEST_KEYS, { force: true });
  });

  it('hashes and verifies a correct password', async () => {
    await users.createUser('alice', FIXTURE_PASSWORD);
    const stored = await users.findByUsername('alice');
    expect(stored).not.toBeNull();
    expect(await users.verifyPassword(stored!, FIXTURE_PASSWORD)).toBe(true);
  });

  it('fails verification for a wrong password', async () => {
    await users.createUser('bob', FIXTURE_PASSWORD);
    const stored = await users.findByUsername('bob');
    expect(await users.verifyPassword(stored!, 'not-the-password')).toBe(false);
  });

  it('stores an argon2id hash that is not the plaintext', async () => {
    await users.createUser('carol', FIXTURE_PASSWORD);
    const stored = await users.findByUsername('carol');
    expect(stored).not.toBeNull();
    expect(stored!.passwordHash).not.toBe(FIXTURE_PASSWORD);
    expect(stored!.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(await argon2.verify(stored!.passwordHash, FIXTURE_PASSWORD)).toBe(true);
  });

  it('never returns the password hash from createUser', async () => {
    const created = await users.createUser('dave', FIXTURE_PASSWORD);
    expect(Object.keys(created)).not.toContain('passwordHash');
  });

  it('rejects an empty username or password', async () => {
    await expect(users.createUser('', FIXTURE_PASSWORD)).rejects.toThrow();
    await expect(users.createUser('erin', '')).rejects.toThrow();
  });
});

describe('Raw database storage (e2e)', () => {
  const RAW_DB = join(__dirname, 'test-idp-raw.db');

  afterAll(() => rmSync(RAW_DB, { force: true }));

  it('never writes the plaintext password to the database file', async () => {
    jest.resetModules();
    rmSync(RAW_DB, { force: true });
    process.env.DB_PATH = RAW_DB;

    const [{ createApp }, { UsersService: FreshUsersService }] = await Promise.all([
      import('../src/app.factory.js'),
      import('../src/users/users.service.js'),
    ]);

    const app = await createApp();
    await app.init();
    const users = app.get(FreshUsersService);
    try {
      await users.createUser('raw-user', FIXTURE_PASSWORD);
    } finally {
      await app.close();
    }

    const bytes = readFileSync(RAW_DB);
    expect(bytes.includes(FIXTURE_PASSWORD)).toBe(false);
    expect(bytes.includes('$argon2id$')).toBe(true);
  });
});

describe('Seed script (e2e)', () => {
  const CREATE_DB = join(__dirname, 'test-seed-create.db');
  const MISSING_DB = join(__dirname, 'test-seed-missing.db');
  const EXISTING_DB = join(__dirname, 'test-seed-existing.db');

  beforeAll(() => {
    rmSync(CREATE_DB, { force: true });
    rmSync(MISSING_DB, { force: true });
    rmSync(EXISTING_DB, { force: true });
  });

  afterAll(() => {
    rmSync(CREATE_DB, { force: true });
    rmSync(MISSING_DB, { force: true });
    rmSync(EXISTING_DB, { force: true });
  });

  it('creates the user when the environment is set', async () => {
    const res = await runSeed({
      SEED_USERNAME: 'seed-user',
      SEED_PASSWORD: FIXTURE_PASSWORD,
      DB_PATH: CREATE_DB,
    });
    expect(res.code).toBe(0);
    expect(res.stdout + res.stderr).not.toContain(FIXTURE_PASSWORD);

    const db = new Database(CREATE_DB, { readonly: true });
    const row = db
      .prepare('SELECT username, passwordHash FROM user WHERE username = ?')
      .get('seed-user') as { username: string; passwordHash: string } | undefined;
    db.close();

    expect(row?.username).toBe('seed-user');
    expect(row?.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(res.stdout + res.stderr).not.toContain(row?.passwordHash ?? '\u0000');
  }, 30000);

  it('refuses when the environment is missing', async () => {
    const res = await runSeed({
      SEED_USERNAME: '',
      SEED_PASSWORD: '',
      DB_PATH: MISSING_DB,
    });
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('SEED_USERNAME and SEED_PASSWORD must both be set');
  }, 30000);

  it('is idempotent: a second run reports the existing user and does not overwrite it', async () => {
    const env = {
      SEED_USERNAME: 'seed-user-2',
      SEED_PASSWORD: FIXTURE_PASSWORD,
      DB_PATH: EXISTING_DB,
    };
    expect((await runSeed(env)).code).toBe(0);

    const db = new Database(EXISTING_DB, { readonly: true });
    const before = db
      .prepare('SELECT passwordHash FROM user WHERE username = ?')
      .get('seed-user-2') as { passwordHash: string };
    db.close();

    const second = await runSeed(env);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain('already exists');
    expect(second.stdout + second.stderr).not.toContain(FIXTURE_PASSWORD);

    const db2 = new Database(EXISTING_DB, { readonly: true });
    const after = db2
      .prepare('SELECT passwordHash FROM user WHERE username = ?')
      .get('seed-user-2') as { passwordHash: string };
    db2.close();
    expect(after.passwordHash).toBe(before.passwordHash);
  }, 30000);
});
