import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { CryptoError, ENC_PREFIX, decryptField, encryptField } from '@life/crypto';
import type { NutrientVector } from '@life/nutrition';
import { KeysService } from '../keys/keys.service';
import { completeVector, readStoredVector } from '../foods/content';
import { Entry } from './entry.entity';
import type { CreateEntryDto, MealGroup } from './dto/create-entry.dto';
import type { UpdateEntryDto } from './dto/update-entry.dto';
import {
  EntriesCache,
  toCachedEntryRow,
  type CachedEntryRow,
} from './entries-cache';

/**
 * The wire shape of a diary entry. `ownerSub` is deliberately absent —
 * ownership is never echoed back to the client (mirrors `FoodDto`/`TargetDto`).
 * `nutrients` is the decrypted, confirmed snapshot; the client sums the day
 * with the shared `@life/nutrition` model, exactly as the service would.
 */
export interface EntryDto {
  id: string;
  date: string;
  mealGroup: MealGroup;
  foodId: string;
  quantity: number;
  nutrients: NutrientVector;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * AAD for an entry's confirmed nutrient snapshot (`SPEC-meal-service` Code
 * Style): `life.v1|<sub>|meal|entry|<entryId>`. Byte-exact and owned here so
 * the write and read paths can never disagree (lesson 0016); the id is
 * service-generated (`randomUUID`) before insert so the string is
 * reconstructible at decrypt time.
 */
function entryNutrientsAad(sub: string, entryId: string): string {
  return `life.v1|${sub}|meal|entry|${entryId}`;
}

/**
 * Owner-scoped diary entries (`SPEC-meal-service` entries / Nutrient
 * semantics).
 *
 * Three rules hold everywhere below:
 * - `ownerSub` is the caller's `sub`, supplied by the controller from
 *   `@Principal()`; it is a predicate on every read and write, and a foreign id
 *   is indistinguishable from a missing one (same 404).
 * - The confirmed snapshot is sealed with byte-exact AAD before it reaches the
 *   DB or the cache, and is never re-derived from a live food row on read — so
 *   editing a food cannot rewrite history.
 * - Reads go `cache → loader`; writes go `BE → DB → bump`. The cache holds rows
 *   as persisted (ciphertext), so decrypt and the meal-group filter always run
 *   after every hit. No request path reads a process clock (lesson 0019): the
 *   day is always the client's `date`.
 */
@Injectable()
export class EntriesService {
  private readonly logger = new Logger(EntriesService.name);

  constructor(
    @InjectRepository(Entry) private readonly entries: Repository<Entry>,
    private readonly cache: EntriesCache,
    private readonly keys: KeysService,
  ) {}

  /**
   * Decrypt-or-passthrough (`SPEC-meal-service` Code Style, mirroring
   * `FoodsService`): an `enc.v1.` value is opened against its AAD; anything
   * else is a legacy plaintext row that passes through. A decrypt failure is
   * fail-closed — an ids-only log line, then the typed error is rethrown,
   * never ciphertext or garbage on the wire.
   */
  private openField(stored: string, dek: Buffer | null, aad: string, id: string): string {
    if (!stored.startsWith(ENC_PREFIX)) return stored;
    if (!dek) {
      // Callers only reach here after proving a key was required; failing closed
      // beats ever returning ciphertext to the API.
      throw new CryptoError('missing data key for an encrypted field');
    }
    try {
      return decryptField(dek, stored, aad);
    } catch (err) {
      this.logger.error('decrypt failed for ' + id);
      throw err;
    }
  }

  /** Resolve the owner DEK at most once per read; null when nothing is sealed. */
  private async readDek(sub: string, rows: CachedEntryRow[]): Promise<Buffer | null> {
    const needs = rows.some(
      (row) => typeof row.nutrients === 'string' && row.nutrients.startsWith(ENC_PREFIX),
    );
    if (!needs) return null;
    return this.keys.getDekForRead(sub);
  }

  /** Assemble the wire DTO from a stored row; the snapshot is opened here. */
  private toDto(row: CachedEntryRow, sub: string, dek: Buffer | null): EntryDto {
    return {
      id: row.id,
      date: row.date,
      mealGroup: row.mealGroup as MealGroup,
      foodId: row.foodId,
      quantity: row.quantity,
      nutrients: readStoredVector(
        this.openField(row.nutrients, dek, entryNutrientsAad(sub, row.id), row.id),
      ),
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * The owner's non-trashed entries for a date, optionally narrowed to one meal
   * group. Key `meal:<sub>:v<gen>:entries:<date>`.
   *
   * The date is part of the fetch identity (one entry set per day per owner),
   * so it is in the key; the meal-group filter is applied **post-hit, in
   * memory, after decrypt** (`SPEC-meal-service` Cache Rules) and never enters
   * the key. Freshness is the request's UTC instants, `updatedAt ASC` with an
   * `id` tie-break, so the order can never depend on the host clock.
   */
  async findAll(sub: string, date: string, meal?: MealGroup): Promise<EntryDto[]> {
    const rows = await this.cache.day(sub, date, () => this.loadDay(sub, date));
    const dek = await this.readDek(sub, rows);
    const decoded = rows.map((row) => this.toDto(row, sub, dek));
    if (!meal) return decoded;
    return decoded.filter((entry) => entry.mealGroup === meal);
  }

  /**
   * One entry by id. Key `meal:<sub>:v<gen>:entry:<id>`.
   *
   * The loader's `where` carries `ownerSub`, so a foreign id throws the same
   * 404 a missing id does: a second owner cannot probe for existence, let
   * alone read the row (`SPEC-meal-service` Success Criterion 1).
   */
  async findOne(sub: string, id: string): Promise<EntryDto> {
    const row = await this.cache.one(sub, id, async () => {
      const entry = await this.entries.findOne({
        where: { id, ownerSub: sub, deletedAt: IsNull() },
      });
      if (!entry) throw new NotFoundException('Entry not found');
      return toCachedEntryRow(entry);
    });
    const dek = await this.readDek(sub, [row]);
    return this.toDto(row, sub, dek);
  }

  /**
   * The owner's non-trashed entries for one date, as persisted ciphertext
   * rows. Metadata-only predicate: the date and owner are plaintext columns,
   * and the snapshot (an envelope) is never matched in SQL.
   */
  private async loadDay(sub: string, date: string): Promise<CachedEntryRow[]> {
    const found = await this.entries.find({
      where: { ownerSub: sub, date, deletedAt: IsNull() },
      order: { updatedAt: 'ASC', id: 'ASC' },
    });
    return found.map(toCachedEntryRow);
  }

  async create(sub: string, dto: CreateEntryDto): Promise<EntryDto> {
    // Service-generated id: the AAD binds it, so it exists before the ciphertext.
    const id = randomUUID();
    const dek = await this.keys.getOrCreateDek(sub);
    const vector = this.requireVector(dto.nutrients);

    const entry = this.entries.create({
      id,
      ownerSub: sub,
      date: dto.date,
      mealGroup: dto.mealGroup,
      foodId: dto.foodId,
      quantity: dto.quantity,
      nutrients: this.sealVector(dek, vector, entryNutrientsAad(sub, id)),
      version: 0,
      deletedAt: null,
    });
    const saved = await this.entries.save(entry);

    // Bump AFTER the mutation: pre-write reads were born under the old
    // generation and die here; a thrown save never bumps.
    await this.cache.bump(sub);
    return this.toDto(toCachedEntryRow(saved), sub, dek);
  }

  async update(sub: string, id: string, dto: UpdateEntryDto): Promise<EntryDto> {
    const entry = await this.entries.findOne({
      where: { id, ownerSub: sub, deletedAt: IsNull() },
    });
    if (!entry) throw new NotFoundException('Entry not found');
    if (dto.expectedVersion !== undefined && entry.version !== dto.expectedVersion) {
      throw new ConflictException('Entry was modified');
    }

    // The snapshot changes only when the client sends corrected numbers; the
    // stored row is never re-derived from a live food. A quantity change
    // without a corrected vector is rejected so the pair can never disagree.
    if (dto.quantity !== undefined && dto.nutrients === undefined) {
      throw new BadRequestException('nutrients are required to change quantity');
    }

    const dek = await this.keys.getOrCreateDek(sub);
    if (dto.date !== undefined) entry.date = dto.date;
    if (dto.mealGroup !== undefined) entry.mealGroup = dto.mealGroup;
    if (dto.quantity !== undefined) entry.quantity = dto.quantity;
    if (dto.nutrients !== undefined) {
      entry.nutrients = this.sealVector(
        dek,
        this.requireVector(dto.nutrients),
        entryNutrientsAad(sub, entry.id),
      );
    }

    entry.version += 1;
    const saved = await this.entries.save(entry);

    await this.cache.bump(sub);
    return this.toDto(toCachedEntryRow(saved), sub, dek);
  }

  async remove(sub: string, id: string): Promise<void> {
    const entry = await this.entries.findOne({
      where: { id, ownerSub: sub, deletedAt: IsNull() },
    });
    if (!entry) throw new NotFoundException('Entry not found');
    entry.deletedAt = new Date();
    await this.entries.save(entry);
    await this.cache.bump(sub);
  }

  /**
   * Parse a client vector through the single completeness rule. A partial or
   * unknown nutrient field is a 400, not a silent coercion — the day sum would
   * otherwise be quietly wrong.
   */
  private requireVector(value: unknown): NutrientVector {
    try {
      return completeVector(value);
    } catch {
      throw new BadRequestException('nutrients must carry the complete nutrient vector');
    }
  }

  /** Seal a complete vector as the JSON payload the DB and cache both hold. */
  private sealVector(dek: Buffer, vector: NutrientVector, aad: string): string {
    return encryptField(dek, JSON.stringify(vector), aad);
  }
}