import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { Session } from './session.entity';

/** 30 days absolute — tech-lead call, aligned with the refresh-token lifetime. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Session tokens are hashed at rest; only this digest is ever persisted. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class SessionsService {
  constructor(@InjectRepository(Session) private readonly sessions: Repository<Session>) {}

  /** Creates a session and returns the raw token for the cookie; only its SHA-256 is stored. */
  async create(user: User): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const session = this.sessions.create({
      tokenHash: hashToken(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });
    await this.sessions.save(session);
    return token;
  }

  /** Resolves the owning user for a live token; expired or unknown tokens yield null. */
  async findValid(token: string | undefined): Promise<User | null> {
    if (!token) return null;
    const session = await this.sessions.findOne({
      where: { tokenHash: hashToken(token) },
      relations: { user: true },
    });
    if (!session || !session.user) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;
    return session.user;
  }

  /** Deletes the session row for a token; deleting an absent token is a no-op. */
  async destroy(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.sessions.delete({ tokenHash: hashToken(token) });
  }
}
