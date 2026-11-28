import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ENC_PREFIX, decryptField, encryptField } from '@life/crypto';
import { KeysService } from '@life/service-kit';
import { MEDITATION_CACHE, type MeditationCache } from '../cache/meditation-cache.js';
import { DATE_ONLY } from './goal-history.dto.js';
import { GoalHistory } from './goal-history.entity.js';

/**
 * Field AAD for one day's goal envelope, byte-exact and uniform: the identical string is
 * rebuilt at encrypt and decrypt, and both the owner's `sub` and the day are in it, so one
 * owner's envelope cannot be replayed as another's — nor one day's as another day's.
 */
function goalAad(ownerSub: string, validFrom: string): string {
  return `life.v1|${ownerSub}|meditation|goal|${validFrom}`;
}

/** A goal row as the routes serve it: the day it took effect on, and the minutes it aimed for. */
export interface GoalRow {
  validFrom: string;
  minutes: number;
}

/** A goal row as stored — the shape the cache holds, ciphertext and all. */
interface CachedGoalRow {
  ownerSub: string;
  validFrom: string;
  content: string;
}

/** The sealed part of a goal row: the minutes, wrapped so no number is ever a column value. */
interface GoalContent {
  minutes: number;
}

function sealGoal(dek: Buffer, ownerSub: string, day: string, minutes: number): string {
  const content: GoalContent = { minutes };
  return encryptField(dek, JSON.stringify(content), goalAad(ownerSub, day));
}

/** A list is usable from the cache only when every row carries the envelope; one plaintext row is a miss. */
function areCiphertextGoalRows(rows: CachedGoalRow[]): boolean {
  return rows.every((row) => row.content.startsWith(ENC_PREFIX));
}

function decodeGoal(dek: Buffer, row: CachedGoalRow): GoalRow {
  if (!row.content.startsWith(ENC_PREFIX)) throw new Error('goal entry is not ciphertext');
  const plaintext = decryptField(dek, row.content, goalAad(row.ownerSub, row.validFrom));
  return { validFrom: row.validFrom, minutes: (JSON.parse(plaintext) as GoalContent).minutes };
}

/**
 * The locked day→goal rule (`SPEC-meditation-app` §1, copied from `focus-service` §1): for a
 * day, the goal is the minutes of the newest row that took effect on or before it. A day
 * preceding every row has no goal at all — `null`, never a fallback value.
 *
 * Rows arrive oldest first (`GET /settings/goals` and the loader both order by `validFrom`),
 * so the scan keeps the last row that applies. Text days compare lexically, which
 * `YYYY-MM-DD` makes exactly calendar order.
 */
export function resolveGoal(rows: GoalRow[], day: string): number | null {
  let applicable: number | null = null;
  for (const row of rows) {
    if (row.validFrom <= day) applicable = row.minutes;
  }
  return applicable;
}

/**
 * The client's own day, or a 400. The service never reads its own clock for "today", so a
 * missing or impossible day is refused rather than defaulted. A shape-valid day that is not a
 * real calendar day (`2026-02-31`) is impossible too: the round trip through UTC shows it did
 * not survive.
 */
export function requireDay(date: string | undefined): string {
  if (date === undefined) throw new BadRequestException('date is required (YYYY-MM-DD)');
  if (!DATE_ONLY.test(date)) throw new BadRequestException('date must be YYYY-MM-DD');

  const asUtc = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(asUtc.getTime()) || asUtc.toISOString().slice(0, 10) !== date) {
    throw new BadRequestException('date must be a real calendar day');
  }
  return date;
}

/**
 * The owner's daily-goal history (`SPEC-meditation-app` §1): one row per day a goal was set,
 * so a past day keeps the goal that applied then instead of being re-measured against today's.
 *
 * Reads go `cache → database`: the loader inside `getThrough` is the only place that touches the
 * repository, and it reads the ciphertext rows as persisted, under the one per-owner `goals` key
 * — the whole list, because it is tiny and carries no fetch parameters. Writes go
 * `database → generation bump`, and decryption happens after the hit, never inside the cache.
 */
@Injectable()
export class GoalHistoryService {
  constructor(
    @InjectRepository(GoalHistory) private readonly goals: Repository<GoalHistory>,
    @Inject(MEDITATION_CACHE) private readonly cache: MeditationCache,
    private readonly keys: KeysService,
  ) {}

  /**
   * Upsert the goal for exactly `day`; every other day's row is left untouched, so a past day
   * keeps what it resolved to. The unique `(ownerSub, validFrom)` index turns this into "replace
   * that day's row, touch no other", in one statement — no read-then-write race.
   */
  async setGoal(ownerSub: string, date: string | undefined, minutes: number): Promise<GoalRow> {
    const validFrom = requireDay(date);
    const dek = await this.keys.getOrCreateDek(ownerSub);

    await this.goals.upsert(
      { ownerSub, validFrom, content: sealGoal(dek, ownerSub, validFrom, minutes) },
      ['ownerSub', 'validFrom'],
    );

    // Bump AFTER the write: a read landing during it must not repopulate the new generation
    // with pre-write rows, and a thrown write never bumps.
    await this.cache.bumpGeneration(ownerSub);
    return { validFrom, minutes };
  }

  /** The owner's whole history, oldest first, decrypted after the cache — never inside its loader. */
  async findAll(ownerSub: string): Promise<GoalRow[]> {
    const rows = await this.cache.getThrough(ownerSub, 'goals', () => this.loadAll(ownerSub), {
      cacheable: areCiphertextGoalRows,
    });
    if (rows.length === 0) return [];

    const dek = await this.keys.getDekForRead(ownerSub);
    return rows.map((row) => decodeGoal(dek, row));
  }

  /** The rows as stored, owner-scoped; lives inside the cache's loader and nowhere else. */
  private async loadAll(ownerSub: string): Promise<CachedGoalRow[]> {
    const rows = await this.goals.find({
      where: { ownerSub },
      order: { validFrom: 'ASC' },
    });
    return rows.map((row) => ({
      ownerSub,
      validFrom: row.validFrom,
      content: row.content,
    }));
  }
}
