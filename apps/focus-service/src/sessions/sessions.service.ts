import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Between, Repository } from 'typeorm';
import { DEFAULT_PAGE_LIMIT, paginate } from '@life/service-kit';
import { FOCUS_CACHE, type FocusCache } from '../cache/focus-cache.js';
import type { CreateSessionDto } from './dto/create-session.dto.js';
import type { ListSessionsQuery } from './dto/list-sessions.query.js';
import { Session } from './session.entity.js';

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

/**
 * One page of the owner's sessions plus the cursor that continues it
 * (`SPEC-pagination-seam` §4: plural entity key, `SessionRow` → `sessions`).
 */
export interface SessionPage {
  sessions: SessionRow[];
  nextCursor: string | null;
  /** How many rows the whole filtered set holds — never this page's length. */
  total: number;
}

/**
 * The list's strictly-after test: `date ASC, createdAt ASC, id ASC` — the exact
 * order `loadRange` sorts in, compared on the served ISO string so the cursor and
 * the cached row speak one clock. `date` compares lexically because `YYYY-MM-DD`
 * makes that calendar order.
 *
 * The boundary is the *key*, not the row: a cursor naming a row that has since
 * been deleted still lands between the same two neighbours, so a page neither
 * repeats nor skips across the boundary.
 */
function afterListPosition(row: SessionRow, at: string[]): boolean {
  const [date, createdAt, id] = at;
  if (row.date !== date) return row.date > date;
  if (row.createdAt !== createdAt) return row.createdAt > createdAt;
  return row.id > id;
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
   * One page of the owner's rows across `[from, to]`, oldest first, through the
   * read-through cache. Key `focus:<sub>:v<gen>:sessions:<from>:<to>`: the range
   * *is* the fetch identity, so it belongs in the key; `limit` and `cursor` do not,
   * because paging is a projection over the whole cached range — one entry serves
   * every page of it (Contract 2 Rule 3).
   */
  async findAll(sub: string, query: ListSessionsQuery): Promise<SessionPage> {
    const { from, to } = query;
    const rows = await this.cache.getThrough(sub, `focus:sessions:${from}:${to}`, () =>
      this.loadRange(sub, { from, to }),
    );

    const page = paginate(rows, {
      limit: query.limit ?? DEFAULT_PAGE_LIMIT,
      cursor: query.cursor,
      keyOf: (row) => [row.date, row.createdAt, row.id],
      after: afterListPosition,
    });
    return { sessions: page.rows, nextCursor: page.nextCursor, total: page.total };
  }

  /** Range load, owner-scoped; days are text so `YYYY-MM-DD` compares lexically. */
  private async loadRange(sub: string, range: { from: string; to: string }): Promise<SessionRow[]> {
    const found = await this.sessions.find({
      where: { ownerSub: sub, date: Between(range.from, range.to) },
      order: { date: 'ASC', createdAt: 'ASC', id: 'ASC' },
    });
    return found.map(toSessionRow);
  }
}
