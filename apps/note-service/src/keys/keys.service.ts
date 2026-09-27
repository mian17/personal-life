import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CryptoError, generateDek, unwrapDek, wrapDek } from '@life/crypto';
import { UserKeys } from './user-keys.entity';

/** DI token for the process-wide master key (a 32-byte `Buffer`). */
export const MASTER_KEY = Symbol('NOTE_MASTER_KEY');

/** Env var holding the base64 32-byte master key (`D3`). */
export const MASTER_KEY_ENV = 'NOTE_MASTER_KEY';

/**
 * DEK custody for `notes-at-rest` (`SPEC-notes-at-rest` Encryption Rules / `D2`).
 *
 * - Provisioning is lazy: the first content write for a `sub` generates a fresh
 *   32-byte DEK, wraps it under the master key, and inserts one `user_keys` row.
 * - Reads never provision; a missing row fails closed with `CryptoError`.
 * - Each `sub`'s DEK is unwrapped at most once per process: the plaintext DEK lives
 *   in a process-local `Map` and is never serialized or logged.
 *
 * Concurrency assumption: this service is single-user (documented in `D7`/plan).
 * `getOrCreateDek` performs a plain insert with no DB-level transaction/lock, so two
 * simultaneous first-writes for the same brand-new `sub` could race into a duplicate
 * `user_keys` insert (the PK rejects the loser). At single-user volume the window is
 * negligible; multi-user hardening would use `INSERT ... ON CONFLICT DO NOTHING`
 * plus a re-read.
 */
@Injectable()
export class KeysService {
  private readonly logger = new Logger(KeysService.name);

  /** Process-local plaintext-DEK memo. Never persisted, never logged. */
  private readonly dekCache = new Map<string, Buffer>();

  constructor(
    @InjectRepository(UserKeys)
    private readonly userKeys: Repository<UserKeys>,
    @Inject(MASTER_KEY)
    private readonly masterKey: Buffer,
  ) {}

  /**
   * Return the owner's DEK, provisioning one on first use. Used by the write path.
   */
  async getOrCreateDek(sub: string): Promise<Buffer> {
    const cached = this.dekCache.get(sub);
    if (cached) {
      return cached;
    }

    const existing = await this.userKeys.findOne({ where: { sub } });
    if (existing) {
      return this.unwrapAndCache(sub, existing.wrappedDek);
    }

    const dek = generateDek();
    try {
      await this.userKeys.insert({
        sub,
        wrappedDek: wrapDek(dek, this.masterKey),
        kekVersion: 1,
        createdAt: new Date(),
      });
    } catch (err) {
      // Lost a concurrent first-write race: the winner's row is authoritative.
      const winner = await this.userKeys.findOne({ where: { sub } });
      if (winner) {
        return this.unwrapAndCache(sub, winner.wrappedDek);
      }
      throw err;
    }
    this.dekCache.set(sub, dek);
    return dek;
  }

  /**
   * Return the owner's DEK for a read path. Never provisions: a missing row (or a
   * tampered/wrong-master envelope) fails closed with `CryptoError`.
   */
  async getDekForRead(sub: string): Promise<Buffer> {
    const cached = this.dekCache.get(sub);
    if (cached) {
      return cached;
    }

    const row = await this.userKeys.findOne({ where: { sub } });
    if (!row) {
      throw new CryptoError(`no encryption key provisioned for sub ${sub}`);
    }
    return this.unwrapAndCache(sub, row.wrappedDek);
  }

  /** Unwrap, memoize, and return. Unwrap failures surface as `CryptoError`. */
  private unwrapAndCache(sub: string, wrappedDek: string): Buffer {
    const dek = unwrapDek(wrappedDek, this.masterKey);
    this.dekCache.set(sub, dek);
    this.logger.debug(`unwrapped DEK for sub ${sub}`);
    return dek;
  }
}
