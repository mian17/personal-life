/**
 * The one token store (SPEC.md §3, auth): both adapters read the credentials
 * `npm run ops -- login` writes, so this file is the single source of truth for auth
 * and the only place a token exists at rest. It is written `0600` inside a
 * `0700` directory, replaced atomically, and never logged or printed.
 *
 * A missing, unreadable, or malformed file reads as "no credentials": callers
 * surface the canonical `run \`npm run ops -- login\`` error instead of a parse crash,
 * so a stale file is a recoverable state, never a broken tool.
 */
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** The at-rest credential shape; these field names are part of the store contract. */
export interface StoredTokens {
  accessToken: string;
  /** `undefined` only when the IdP issued no refresh token; then a re-login is required. */
  refreshToken: string | undefined;
  /** Epoch milliseconds after which the access token is stale. */
  expiresAt: number;
}

const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;

/** `LIFE_OPS_CREDENTIALS_PATH` overrides the default location (SPEC.md §3). */
export function credentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.LIFE_OPS_CREDENTIALS_PATH?.trim();
  if (override) return override;
  return join(configHome(env), 'life-ops', 'credentials.json');
}

/** The read seam `ExecutorOptions.readToken` takes: `undefined` means "run login". */
export async function readToken(): Promise<string | undefined> {
  return (await readTokens())?.accessToken;
}

export async function readTokens(): Promise<StoredTokens | undefined> {
  const raw = await readCredentialFile();
  if (raw === undefined) return undefined;
  return parseTokens(raw);
}

/** Writes the pair atomically at `0600`, so a reader never sees a half file. */
export async function storeTokens(tokens: StoredTokens): Promise<void> {
  const path = credentialsPath();
  await mkdir(dirname(path), { recursive: true, mode: DIRECTORY_MODE });

  const scratch = `${path}.${process.pid}.tmp`;
  await writeFile(scratch, `${JSON.stringify(tokens)}\n`, { mode: FILE_MODE });
  await chmod(scratch, FILE_MODE); // writeFile's mode is umask-filtered; assert it exactly
  await rename(scratch, path);
}

/** Removes the store; logout is idempotent and never fails on an absent file. */
export async function clearTokens(): Promise<void> {
  await rm(credentialsPath(), { force: true });
}

function configHome(env: NodeJS.ProcessEnv): string {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  return xdg || join(homedir(), '.config');
}

async function readCredentialFile(): Promise<string | undefined> {
  try {
    return await readFile(credentialsPath(), 'utf8');
  } catch {
    return undefined;
  }
}

function parseTokens(raw: string): StoredTokens | undefined {
  const parsed = parseJson(raw);
  return isStoredTokens(parsed) ? parsed : undefined;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function isStoredTokens(value: unknown): value is StoredTokens {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['accessToken'] === 'string' &&
    (record['refreshToken'] === undefined || typeof record['refreshToken'] === 'string') &&
    typeof record['expiresAt'] === 'number'
  );
}
