import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import {
  USERS_CACHE,
  USERS_CACHE_TTL_SECONDS,
  type UsersCacheLike,
  userCacheKey,
} from './users-cache';

/** A user representation safe to hand outside the service — never includes the hash. */
export interface PublicUser {
  id: string;
  username: string;
  createdAt: Date;
}

function toPublicUser(user: User): PublicUser {
  return { id: user.id, username: user.username, createdAt: user.createdAt };
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    // The cache seam is internal: controllers and `credentials.ts` never know it exists.
    @Inject(USERS_CACHE) private readonly cache: UsersCacheLike,
  ) {}

  async createUser(username: string, password: string): Promise<PublicUser> {
    const name = username?.trim();
    if (!name) throw new BadRequestException('username is required');
    if (!password) throw new BadRequestException('password is required');

    // argon2.hash defaults to argon2id; only the encoded hash is ever stored.
    const passwordHash = await argon2.hash(password);
    const user = this.users.create({ username: name, passwordHash });
    const saved = await this.users.save(user);
    // Any future user mutation must invalidate here too; reads are read-through.
    await this.cache.invalidate(userCacheKey(name));
    return toPublicUser(saved);
  }

  /**
   * Returns the persistence entity (including the hash) so it can be passed to
   * `verifyPassword`; callers must never serialize it. Anything that leaves the
   * service should use the `PublicUser` returned by `createUser`.
   *
   * Reads through the cache seam. The hash stays inside this service and the
   * cache module: it is never logged and never serialized outside here. Cache
   * errors fail open to the DB, so the login response shape never changes.
   */
  findByUsername(username: string): Promise<User | null> {
    const name = username?.trim();
    if (!name) return Promise.resolve(null);
    return this.cache.getThrough(userCacheKey(name), USERS_CACHE_TTL_SECONDS, () =>
      this.users.findOne({ where: { username: name } }),
    );
  }

  /** Constant-time by design — delegates to argon2's verify, never a hand-rolled compare. */
  verifyPassword(user: User, password: string): Promise<boolean> {
    return argon2.verify(user.passwordHash, password);
  }
}
