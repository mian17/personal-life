import * as argon2 from 'argon2';
import type { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';

/**
 * Fixed argon2id hash of a randomly generated, discarded value. Used to spend the
 * same work when a username does not exist so failures cannot be distinguished by
 * timing. It can never match a real password. Never logged.
 */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$lkxizgEnK3dRhXE2JX0DzA$bBc58AQgEwK8kTaTxT9JqHDhjI736aziayNvtjoq2M0';

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
    await argon2.verify(DUMMY_PASSWORD_HASH, secret);
    return null;
  }

  return (await users.verifyPassword(user, secret)) ? user : null;
}
