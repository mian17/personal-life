import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import type { User } from '../users/user.entity.js';
import { UsersService } from '../users/users.service.js';

/**
 * The dummy hash is derived at runtime from a random, discarded value, so no
 * credential-shaped literal lives in the source. `argon2.hash` defaults
 * (argon2id, m=65536, p=4, t=3) are the same cost a real stored hash pays, which
 * is the whole point: an unknown username spends the same work as a known one so
 * failures cannot be distinguished by timing. It can never match a real
 * password. Never logged.
 *
 * Computed once at import (see the warm-up below) so the first unknown-username
 * probe pays verify only, not hash+verify — a lazily created hash would be
 * measurably slower on the very first miss and leak the same signal. A rejected
 * hash is not cached, so a transient failure cannot turn every later miss into a
 * 500 while known users still get the generic 401.
 */
let dummyHash: Promise<string> | undefined;

function dummyPasswordHash(): Promise<string> {
  dummyHash ??= argon2.hash(randomBytes(32).toString('base64')).catch((error: unknown) => {
    dummyHash = undefined;
    throw error;
  });
  return dummyHash;
}

void dummyPasswordHash().catch(() => {});

/** Generic message for every credential failure (no user enumeration). */
export const GENERIC_LOGIN_ERROR = 'Invalid username or password';

/**
 * Verifies credentials with timing equalization: an unknown username still pays
 * for one argon2 verify against the dummy hash. Returns the user on success or
 * null on any failure. Callers must not reveal which case failed.
 */
export async function verifyCredentials(
  users: UsersService,
  username: string | undefined,
  password: string | undefined,
): Promise<User | null> {
  const name = username?.trim() ?? '';
  const secret = password ?? '';
  const user = name ? await users.findByUsername(name) : null;

  if (!user) {
    await argon2.verify(await dummyPasswordHash(), secret);
    return null;
  }

  return (await users.verifyPassword(user, secret)) ? user : null;
}
