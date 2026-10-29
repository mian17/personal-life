import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Between, Repository } from 'typeorm';
import { FOCUS_CACHE, type FocusCache } from '../cache/focus-cache';
import type { CreateSessionDto } from './dto/create-session.dto';
import type { ListSessionsQuery } from './dto/list-sessions.query';
import { Session } from './session.entity';

/**
 * A session row as persisted, which is also the row as served: `createdAt` is the
 * only field the storage type narrows to a string, and no field is renamed
 * (`SPEC-focus-service` Cache Rules — rows, never DTOs).
 */
export interface SessionRow {
  id: string;
  ownerSub: string | null;
  date: string;
  minutes: number;
  createdAt: string;
}

function toSessionRow(session: Session): SessionRow {
  return {
    id: session.id,
    ownerSub: session.ownerSub,
    date: session.date,
    minutes: session.minutes,
    createdAt: session.createdAt.toISOString(),
  };
}

/**
 * Owner-scoped focus sessions (`SPEC-focus-service` §1).
 *
 * Two rules hold on every path below:
 * - `ownerSub` is the caller's `sub`, a predicate on the write and on the read, so
 *   a second owner's range query can never surface the first owner's rows.
 * - Reads go `cache → loader`, writes go `DB → bump`. The cached value is the
 *   serialized row itself, so a hit needs no reassembly at all.
 */
@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @Inject(FOCUS_CACHE) private readonly cache: FocusCache,
  ) {}

  /** Record one block for `sub`; the owner's cached ranges die right after the insert. */
  async create(sub: string, dto: CreateSessionDto): Promise<SessionRow> {
    const session = this.sessions.create({
      id: randomUUID(),
      ownerSub: sub,
      date: dto.date,
      minutes: dto.minutes,
    });
    const saved = await this.sessions.save(session);

    // Bump AFTER the insert: a read that lands during the write must not populate
    // the new generation with pre-write rows, and a thrown insert never bumps.
    await this.cache.bumpGeneration(sub);
    return toSessionRow(saved);
  }

  /**
   * The owner's rows across `[from, to]`, oldest first, through the read-through
   * cache. Key `focus:<sub>:v<gen>:sessions:<from>:<to>`: the range *is* the fetch
   * identity, so it belongs in the key — no filter or pagination exists to join it
   * there.
   */
  findAll(sub: string, query: ListSessionsQuery): Promise<SessionRow[]> {
    const { from, to } = query;
    return this.cache.getThrough(
      sub,
      `focus:sessions:${from}:${to}`,
      () => this.loadRange(sub, { from, to }),
    );
  }

  /** Range load, owner-scoped; days are text so `YYYY-MM-DD` compares lexically. */
  private async loadRange(
    sub: string,
    range: { from: string; to: string },
  ): Promise<SessionRow[]> {
    const found = await this.sessions.find({
      where: { ownerSub: sub, date: Between(range.from, range.to) },
      order: { date: 'ASC', createdAt: 'ASC', id: 'ASC' },
    });
    return found.map(toSessionRow);
  }
}
