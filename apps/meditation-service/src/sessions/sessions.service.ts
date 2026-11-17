import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { IsNull, Repository, type SelectQueryBuilder } from 'typeorm';
import { ENC_PREFIX, decryptField, encryptField } from '@life/crypto';
import { DEFAULT_PAGE_LIMIT, KeysService, paginate } from '@life/service-kit';
import { MEDITATION_CACHE, type MeditationCache } from '../cache/meditation-cache.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  MAX_WINDOW_DAYS,
  canBeFiledOn,
  dayDoneWindow,
  daysBetween,
  windowDayCount,
  type DayDone,
  type DayWindow,
} from './day-done.js';
import { Session } from './session.entity.js';
import type { CreateSittingDto, ListSittingsQuery } from './sessions.dto.js';
import { recordedSitting, type SittingContent } from './sitting-minutes.js';

/**
 * Field AAD for a sitting's envelope, byte-exact and uniform: the identical string is
 * rebuilt at encrypt and decrypt, and the owner's `sub` and the sitting's `id` are both
 * in it, so one envelope cannot be replayed as another owner's — or as another sitting's.
 */
function sittingAad(ownerSub: string, sittingId: string): string {
  return `life.v1|${ownerSub}|meditation|sitting|${sittingId}`;
}

/** A sitting row as stored — the shape the cache holds, ciphertext and all. */
interface StoredSitting {
  id: string;
  ownerSub: string;
  day: string;
  content: string;
  deletedAt: string | null;
  createdAt: string;
  /**
   * SQLite's own insert sequence (`rowid`), the tiebreak `createdAt` cannot give: that column
   * is second-precision, so two sittings in one second would carry the same stamp and fall
   * through to a random uuid. The sequence only ever grows — a delete stamps the row instead of
   * removing it — so within one day it *is* newest-first order. `null` on a row served straight
   * back from an insert, which never reaches a list read.
   */
  recordedSeq: number | null;
}

/** A sitting as the routes serve it: its day, the numbers its envelope carries, no ciphertext. */
export interface Sitting {
  id: string;
  day: string;
  startedAt: string;
  endedAt: string;
  /** The length the sitting was planned for, which is also the ceiling on its minutes. */
  plannedMinutes: number;
  /** The minutes recorded: the planned length, or what was sat and kept. */
  minutes: number;
  /** Whether the sitting reached its planned length, rather than being stopped early. */
  completed: boolean;
  /** `null` on a live sitting; a delete stamps this and never removes the row. */
  deletedAt: string | null;
  createdAt: string;
}

/** One page of the owner's sitting log plus the cursor that continues it. */
export interface SittingPage {
  sessions: Sitting[];
  nextCursor: string | null;
  /** How many live sittings the owner has — the set this page was sliced from. */
  total: number;
}

/**
 * Refuse a window whose first bound is past its last, before any read is measured.
 *
 * `YYYY-MM-DD` compares lexically because it makes calendar order, so the two bounds can be
 * read against each other as they stand. A reversed window is a client bug, not an empty
 * day: serving `[]` for it would answer 200 and hide the mistake.
 */
function rejectReversed({ from, to }: DayWindow): void {
  if (from > to) throw new BadRequestException('from must not be after to');
}

/**
 * Refuse a window wider than a year, before a single day is walked.
 *
 * Every day of the window costs one pass over the owner's rows, so the span is measured
 * first: `daysBetween` on an unbounded window would enumerate millions of days and cost
 * far more than the request that asked for it (a decade is not a day-done grid).
 */
function rejectTooWide(window: DayWindow): void {
  if (windowDayCount(window) > MAX_WINDOW_DAYS) {
    throw new BadRequestException('window is too wide');
  }
}

/**
 * The day a sitting is filed on: the client's own local day, but only when it is the
 * sitting's own day. The client reports both, and an `endedAt` pins the day to its own
 * date within one calendar day — the most any UTC timestamp can be away from the local
 * day it was written on. A report further off is refused rather than filed.
 *
 * The offset itself is never sent, so the server cannot resolve the local day more exactly
 * than this window; the client is the only party holding the owner's clock (assumption 3).
 */
function filedDay(draft: { day: string; endedAt: string }): string {
  if (!canBeFiledOn(draft.day, draft.endedAt)) {
    throw new BadRequestException('day must be the local day of endedAt');
  }
  return draft.day;
}

/**
 * The list's strictly-after test: `day DESC, createdAt DESC, recordedSeq DESC`, the exact order
 * `orderedRows` sorts in. `day` compares lexically because `YYYY-MM-DD` makes that calendar
 * order, and the stored ISO strings keep the cursor and the row on one clock. The insert
 * sequence is compared as a number, so `10` is newer than `9` exactly as SQL reads it.
 *
 * The boundary is the *key*, not the row: a cursor naming a sitting that a delete has
 * since stamped still lands between the same two neighbours, so a page neither repeats
 * nor skips across the boundary.
 */
function afterListPosition(row: StoredSitting, at: string[]): boolean {
  const [day, createdAt, recordedSeq] = at;
  if (row.day !== day) return row.day < day;
  if (row.createdAt !== createdAt) return row.createdAt < createdAt;
  return (row.recordedSeq ?? 0) < Number(recordedSeq);
}

/**
 * The owner's sittings (`SPEC-meditation-app` §1, §5): record one finished sitting, list
 * the live ones by page, serve one, and stamp a delete.
 *
 * Every read goes `cache → database`: the loader inside `getThrough` is the only place that
 * touches the repository — the day window (`sessions:<from>:<to>`), the unbounded log
 * (`sessions:list`) and one sitting (`session:<id>`) — and each loader returns the ciphertext
 * rows as persisted (`## Cache Rules`). Writes go `database → generation bump`, so a read
 * landing mid-write cannot repopulate the new generation with pre-write rows. Deletion is a
 * stamp, never a removal — the row stays and every read filters on `deletedAt IS NULL`, so a
 * deleted sitting leaves every list and detail read while remaining in `meditation.db`.
 *
 * Decryption and paging both run after the hit, never inside the cache: the cache holds
 * rows as persisted and nothing else (Contract 2 Rule 2).
 */
@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @Inject(MEDITATION_CACHE) private readonly cache: MeditationCache,
    private readonly keys: KeysService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Record one finished sitting; the owner's cached reads die right after the insert.
   *
   * The minutes are decided here, never taken from the caller: `recordedSitting` caps
   * them at the planned length however the elapsed time compares to it. An abandoned
   * sitting has no route here at all — nothing is sent for it, so nothing is written.
   */
  async record(ownerSub: string, dto: CreateSittingDto): Promise<Sitting> {
    const contents = recordedSitting(dto);
    const row = await this.sealedRow(ownerSub, dto, filedDay(dto), contents);
    const saved = await this.sessions.save(row);

    // Bump AFTER the insert: a read that lands during the write must not populate the new
    // generation with pre-write rows, and a thrown insert never bumps.
    await this.cache.bumpGeneration(ownerSub);
    return toSitting(toStoredSitting(saved), contents);
  }

  /**
   * One page of the owner's live sittings, newest day first.
   *
   * The log's fetch is not a day window, so it carries its own entry (`sessions:list`): one
   * unbounded read serves every page, and a cursor or a limit never reaches the key.
   */
  async findAll(ownerSub: string, query: ListSittingsQuery): Promise<SittingPage> {
    const rows = await this.listRows(ownerSub);
    const page = paginate(rows, {
      limit: query.limit ?? DEFAULT_PAGE_LIMIT,
      cursor: query.cursor,
      keyOf: (row) => [row.day, row.createdAt, String(row.recordedSeq ?? 0)],
      after: afterListPosition,
    });
    return {
      sessions: await this.toSittings(ownerSub, page.rows),
      nextCursor: page.nextCursor,
      total: page.total,
    };
  }

  /**
   * Every day of the window, with the live minutes it holds and whether they reach the goal.
   *
   * The answer is derived here, after the cache hit and after decryption, and never stored:
   * a stored day-done flag would survive a goal change and lie about it (`## Cache Rules`).
   * The goal is read on every call for the same reason.
   *
   * A reversed window is refused rather than answered: `daysBetween` walks forward, so it
   * would hold no day at all and serve `[]` as though the sitter had sat nothing.
   */
  async daysDone(ownerSub: string, window: DayWindow): Promise<DayDone[]> {
    rejectReversed(window);
    rejectTooWide(window);
    const goalMinutes = await this.storedGoalMinutes(ownerSub);
    const sittings = await this.toSittings(ownerSub, await this.windowRows(ownerSub, window));
    return dayDoneWindow({ days: daysBetween(window), sittings, goalMinutes });
  }

  /** One live sitting, owner-scoped; a deleted or foreign id is a 404, never a leak. */
  async findOne(ownerSub: string, sittingId: string): Promise<Sitting> {
    const row = await this.oneRow(ownerSub, sittingId);
    if (row === null) throw new NotFoundException('no such sitting');
    return toSitting(row, decodeContents(row, await this.keys.getDekForRead(ownerSub)));
  }

  /** Stamp the delete; the row leaves every read and stays in the file. */
  async remove(ownerSub: string, sittingId: string): Promise<void> {
    const row = await this.oneRow(ownerSub, sittingId);
    if (row === null) throw new NotFoundException('no such sitting');

    await this.sessions.update({ id: sittingId, ownerSub }, { deletedAt: new Date() });
    // A write, so the owner's cached reads die: the stamp rides the served rows.
    await this.cache.bumpGeneration(ownerSub);
  }

  /**
   * The window's live rows from the cache, or from the loader behind it.
   *
   * The window bounds are the fetch's identity and the only thing the key carries
   * (`meditation:<sub>:v<gen>:sessions:<from>:<to>`): one entry serves every filter and page
   * of the same window, and nothing request-shaped — a cursor, a limit — ever reaches it.
   */
  private windowRows(ownerSub: string, { from, to }: DayWindow): Promise<StoredSitting[]> {
    return this.cache.getThrough(
      ownerSub,
      `sessions:${from}:${to}`,
      () => this.loadWindow(ownerSub, from, to),
      { cacheable: areCiphertextSittings },
    );
  }

  /**
   * The owner's whole live log, from the cache's one unbounded entry or from its loader.
   *
   * Nothing request-shaped is in the key: the page and the cursor are applied after the hit,
   * so one entry serves every page of the log. The rows are the ciphertext rows as persisted.
   */
  private listRows(ownerSub: string): Promise<StoredSitting[]> {
    return this.cache.getThrough(ownerSub, 'sessions:list', () => this.loadLive(ownerSub), {
      cacheable: areCiphertextSittings,
    });
  }

  /** One live row by id, from the cache or from its loader; `null` is a cached 404 too. */
  private oneRow(ownerSub: string, sittingId: string): Promise<StoredSitting | null> {
    return this.cache.getThrough<StoredSitting | null>(
      ownerSub,
      `session:${sittingId}`,
      () => this.loadOne(ownerSub, sittingId),
      { cacheable: isCiphertextSitting },
    );
  }

  /** The goal as it stands now; every day-done read is measured against this one number. */
  private async storedGoalMinutes(ownerSub: string): Promise<number> {
    const current = await this.settings.findOne(ownerSub);
    return current.goalMinutes;
  }

  /** The row to insert: the measurable part sealed under the owner's DEK. */
  private async sealedRow(
    ownerSub: string,
    dto: CreateSittingDto,
    day: string,
    contents: SittingContent,
  ): Promise<Session> {
    const sittingId = randomUUID();
    const dek = await this.keys.getOrCreateDek(ownerSub);
    return this.sessions.create({
      id: sittingId,
      ownerSub,
      day,
      content: encryptField(dek, JSON.stringify(contents), sittingAad(ownerSub, sittingId)),
      deletedAt: null,
    });
  }

  /** The owner's live rows, as persisted: the sitting log's unbounded read, inside the loader. */
  private loadLive(ownerSub: string): Promise<StoredSitting[]> {
    return this.orderedRows(
      this.sessions
        .createQueryBuilder('sitting')
        .where('sitting.ownerSub = :ownerSub', { ownerSub }),
    );
  }

  /** The window's live rows, as persisted; lives inside the cache's loader and nowhere else. */
  private loadWindow(ownerSub: string, from: string, to: string): Promise<StoredSitting[]> {
    return this.orderedRows(
      this.sessions
        .createQueryBuilder('sitting')
        .where('sitting.ownerSub = :ownerSub', { ownerSub })
        .andWhere('sitting.day BETWEEN :from AND :to', { from, to }),
    );
  }

  /**
   * The live rows in the one order every read of them uses: newest day first, then the insert
   * sequence. The sequence is carried out with the row because the log's cursor is a row's own
   * position, and `rowid` is the only plaintext column that records it.
   */
  private async orderedRows(query: SelectQueryBuilder<Session>): Promise<StoredSitting[]> {
    const { entities, raw } = await query
      .addSelect('"rowid"', 'recordedSeq')
      .andWhere('sitting.deletedAt IS NULL')
      .orderBy('sitting.day', 'DESC')
      .addOrderBy('sitting.createdAt', 'DESC')
      .addOrderBy('"rowid"', 'DESC')
      .getRawAndEntities();

    return entities.map((session, index) =>
      toStoredSitting(session, Number(raw[index]?.recordedSeq)),
    );
  }

  /** One live row, as persisted, or `null`; also the owner-scoped check every write makes. */
  private async loadOne(ownerSub: string, sittingId: string): Promise<StoredSitting | null> {
    const found = await this.sessions.findOne({
      where: { id: sittingId, ownerSub, deletedAt: IsNull() },
    });
    return found === null ? null : toStoredSitting(found);
  }

  /** Decrypt a set of rows with the owner's one DEK; no rows means no key to fetch. */
  private async toSittings(ownerSub: string, rows: StoredSitting[]): Promise<Sitting[]> {
    if (rows.length === 0) return [];
    const dek = await this.keys.getDekForRead(ownerSub);
    return rows.map((row) => toSitting(row, decodeContents(row, dek)));
  }
}

/** A persisted row carries its envelope; a plaintext entry from before then is a miss. */
function isCiphertextSitting(row: StoredSitting | null): boolean {
  return row === null || row.content.startsWith(ENC_PREFIX);
}

function areCiphertextSittings(rows: StoredSitting[]): boolean {
  return rows.every(isCiphertextSitting);
}

function toStoredSitting(session: Session, recordedSeq: number | null = null): StoredSitting {
  return {
    id: session.id,
    ownerSub: session.ownerSub,
    day: session.day,
    content: session.content,
    deletedAt: session.deletedAt === null ? null : session.deletedAt.toISOString(),
    createdAt: session.createdAt.toISOString(),
    recordedSeq,
  };
}

function decodeContents(row: StoredSitting, dek: Buffer): SittingContent {
  const plaintext = decryptField(dek, row.content, sittingAad(row.ownerSub, row.id));
  return JSON.parse(plaintext) as SittingContent;
}

function toSitting(row: StoredSitting, contents: SittingContent): Sitting {
  return {
    id: row.id,
    day: row.day,
    startedAt: contents.startedAt,
    endedAt: contents.endedAt,
    plannedMinutes: contents.plannedMinutes,
    minutes: contents.minutes,
    completed: contents.completed,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
  };
}
