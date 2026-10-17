/**
 * Auth suite (SPEC.md §7, §9.5): `login` runs against the stub IdP
 * (`test/support/stub-idp.ts`), the credentials file lands at mode `0600`, no
 * token byte reaches stdout or stderr, and refresh rotation replaces the stored
 * pair. No test contacts the real IdP.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { login } from '../src/auth/login';
import { refresh } from '../src/auth/refresh';
import {
  clearTokens,
  credentialsPath,
  readToken,
  readTokens,
  storeTokens,
} from '../src/auth/token-store';
import { sampleApiToken } from './support/stub-api';
import { startStubIdp, type StubIdp } from './support/stub-idp';

const VALID_REFRESH = 'stub.refresh.token';

let idp: StubIdp;
let credentialsFile = '';
let savedCredentialsPath: string | undefined;

beforeEach(async () => {
  idp = await startStubIdp();
  credentialsFile = join(mkdtempSync(join(tmpdir(), 'life-ops-auth-')), 'credentials.json');
  savedCredentialsPath = process.env.LIFE_OPS_CREDENTIALS_PATH;
  process.env.LIFE_OPS_CREDENTIALS_PATH = credentialsFile;
});

afterEach(async () => {
  if (savedCredentialsPath === undefined) delete process.env.LIFE_OPS_CREDENTIALS_PATH;
  else process.env.LIFE_OPS_CREDENTIALS_PATH = savedCredentialsPath;
  rmSync(dirname(credentialsFile), { recursive: true, force: true });
  await idp.stop();
});

describe('login', () => {
  it('stores the tokens the stub IdP minted', async () => {
    const tokens = await loginAgainstStub();

    expect(tokens.accessToken).toBe(sampleApiToken);
    expect(await readToken()).toBe(sampleApiToken);
    expect(await readTokens()).toEqual(expect.objectContaining({ refreshToken: expect.any(String) }));
  });

  it('writes the credentials file at mode 0600', async () => {
    await loginAgainstStub();

    const mode = (await stat(credentialsPath())).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('prints no token byte to stdout or stderr', async () => {
    const printed = capturePrinted();
    const tokens = await loginAgainstStub();
    const output = printed();

    expect(output).not.toContain(tokens.accessToken);
    expect(output).not.toContain(tokens.refreshToken as string);
  });

  it('writes the token into the store, not into the captured output', async () => {
    const printed = capturePrinted();
    await loginAgainstStub();

    const stored = await readFile(credentialsPath(), 'utf8');
    expect(stored).toContain(sampleApiToken);
    expect(printed()).not.toContain(sampleApiToken);
  });
});

describe('refresh rotation', () => {
  it('replaces the stored access token with the rotated one', async () => {
    await loginAgainstStub();

    const rotated = await refresh({ issuer: idp.issuer });

    expect(idp.rotations()).toBe(1);
    expect(rotated?.accessToken).not.toBe(sampleApiToken);
    expect((await readTokens())?.accessToken).toBe(rotated?.accessToken);
  });

  it('replaces the stored refresh token so the old one cannot replay', async () => {
    await loginAgainstStub();
    const firstRefresh = (await readTokens())?.refreshToken;

    await refresh({ issuer: idp.issuer });

    expect((await readTokens())?.refreshToken).not.toBe(firstRefresh);
  });

  it('rotates again from the newly stored refresh token', async () => {
    await loginAgainstStub();

    await refresh({ issuer: idp.issuer });
    const second = await refresh({ issuer: idp.issuer });

    expect(idp.rotations()).toBe(2);
    expect(second?.accessToken).toBe('stub.access.token.rotated.2');
  });

  it('answers "login required" when the store holds no refresh token', async () => {
    await storeTokens({ accessToken: sampleApiToken, refreshToken: undefined, expiresAt: Date.now() + 3600000 });

    expect(await refresh({ issuer: idp.issuer })).toBeUndefined();
    expect(idp.rotations()).toBe(0);
  });
});

describe('the credential store', () => {
  it('reads a malformed file as "no credentials"', async () => {
    await storeTokens({ accessToken: sampleApiToken, refreshToken: VALID_REFRESH, expiresAt: 1 });
    await overwriteCredentialsWith('{ not json');

    expect(await readTokens()).toBeUndefined();
    expect(await readToken()).toBeUndefined();
  });

  it('reads a schema-violating file as "no credentials"', async () => {
    await overwriteCredentialsWith(JSON.stringify({ accessToken: 7 }));

    expect(await readTokens()).toBeUndefined();
  });

  it('forgets the tokens on logout', async () => {
    await loginAgainstStub();

    await clearTokens();

    expect(await readToken()).toBeUndefined();
  });

  it('treats logout on an absent file as success', async () => {
    await expect(clearTokens()).resolves.toBeUndefined();
    await expect(clearTokens()).resolves.toBeUndefined();
  });
});

async function loginAgainstStub() {
  return await login({ issuer: idp.issuer, openBrowser: idp.openBrowser });
}

async function overwriteCredentialsWith(raw: string): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(credentialsPath(), raw, 'utf8');
}

/** Collects every byte written to stdout/stderr between the call and the returned read. */
function capturePrinted(): () => string {
  const written: string[] = [];
  const record = (chunk: unknown): boolean => {
    written.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  };
  const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(record);
  const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(record);
  return () => {
    stdout.mockRestore();
    stderr.mockRestore();
    return written.join('');
  };
}
