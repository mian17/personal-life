import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { CryptoError, ENC_PREFIX, decryptField, encryptField } from '@life/crypto';
import type { NutrientVector } from '@life/nutrition';
import { KeysService } from '@life/service-kit';
import { completeVector, readStoredVector } from '../foods/content';
import type { MealGroup } from '../entries/dto/create-entry.dto';
import { SavedMeal } from './saved-meal.entity';
import { SavedMealItem } from './saved-meal-item.entity';
import type { CreateSavedMealDto } from './dto/create-saved-meal.dto';
import {
  SavedMealsCache,
  toCachedSavedMealRow,
  type CachedSavedMealItemRow,
  type CachedSavedMealRow,
} from './saved-meals-cache';

/**
 * The wire shape of one frozen item. `foodId` is optional metadata; the
 * quantity and the decrypted vector are the whole truth.
 */
export interface SavedMealItemDto {
  id: string;
  foodId: string | null;
  quantity: number;
  nutrients: NutrientVector;
}

/**
 * The wire shape of a saved meal. `ownerSub` is deliberately absent —
 * ownership is never echoed back (mirrors `FoodDto`/`EntryDto`).
 */
export interface SavedMealDto {
  id: string;
  name: string;
  mealGroup: MealGroup;
  items: SavedMealItemDto[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * AAD for a saved meal's name: `life.v1|<sub>|meal|saved-meal-name|<id>`.
 * Byte-exact and owned here so write and read can never disagree (lesson 0016).
 */
function savedMealNameAad(sub: string, savedMealId: string): string {
  return `life.v1|${sub}|meal|saved-meal-name|${savedMealId}`;
}

/**
 * AAD for one frozen item's vector: `life.v1|<sub>|meal|meal|<itemId>` (the
 * `meal` field segment is the item corpus, matching `saved-meal-item.entity.ts`).
 */
function savedMealItemAad(sub: string, itemId: string): string {
  return `life.v1|${sub}|meal|meal|${itemId}`;
}

/**
 * Owner-scoped saved meals (`SPEC-meal-service` saved meals; intent "saved meal
 * = frozen snapshot").
 *
 * A saved meal is a **copy** of the corrected values at save time: the service
 * never reads a live food row to build or return one, and it never calls Gemini
 * — re-logging is the BFF composing `GET /api/saved-meals/:id` then
 * `POST /api/entries` from the frozen numbers. So editing (or deleting) the
 * source food cannot rewrite a saved meal's history.
 *
 * `ownerSub` is the caller's `sub` from `@Principal()` and a predicate on every
 * read and write: a foreign id is indistinguishable from a missing one (404).
 */
@Injectable()
export class SavedMealsService {
  private readonly logger = new Logger(SavedMealsService.name);

  constructor(
    @InjectRepository(SavedMeal) private readonly meals: Repository<SavedMeal>,
    @InjectRepository(SavedMealItem) private readonly items: Repository<SavedMealItem>,
    private readonly cache: SavedMealsCache,
    private readonly keys: KeysService,
  ) {}

  /**
   * Decrypt-or-passthrough (mirrors `EntriesService`): an `enc.v1.` value is
   * opened against its AAD; anything else is a legacy plaintext row. A decrypt
   * failure is fail-closed — an ids-only log line, then the typed error.
   */
  private openField(stored: string, dek: Buffer | null, aad: string, id: string): string {
    if (!stored.startsWith(ENC_PREFIX)) return stored;
    if (!dek) {
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
  private readDek(sub: string, rows: CachedSavedMealRow[]): Promise<Buffer | null> {
    const needs = rows.some(
      (row) =>
        typeof row.name === 'string' &&
        (row.name.startsWith(ENC_PREFIX) ||
          row.items.some((item) => item.nutrients?.startsWith(ENC_PREFIX))),
    );
    if (!needs) return Promise.resolve(null);
    return this.keys.getDekForRead(sub);
  }

  /** Assemble the wire DTO; the name and every item vector are opened here. */
  private toDto(row: CachedSavedMealRow, sub: string, dek: Buffer | null): SavedMealDto {
    return {
      id: row.id,
      name: this.openField(row.name, dek, savedMealNameAad(sub, row.id), row.id),
      mealGroup: row.mealGroup as MealGroup,
      items: row.items.map((item) => this.toItemDto(item, sub, dek)),
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toItemDto(item: CachedSavedMealItemRow, sub: string, dek: Buffer | null): SavedMealItemDto {
    return {
      id: item.id,
      foodId: item.foodId,
      quantity: item.quantity,
      nutrients: readStoredVector(
        this.openField(item.nutrients, dek, savedMealItemAad(sub, item.id), item.id),
      ),
    };
  }

  /**
   * The owner's non-trashed saved meals, newest-first.
   * Key `meal:<sub>:v<gen>:saved:list` — one entry serves every list read.
   */
  async findAll(sub: string): Promise<SavedMealDto[]> {
    const rows = await this.cache.list(sub, () => this.loadAll(sub));
    const dek = await this.readDek(sub, rows);
    return rows.map((row) => this.toDto(row, sub, dek));
  }

  /**
   * One saved meal by id. Key `meal:<sub>:v<gen>:saved:one:<id>`.
   * The loader's `where` carries `ownerSub`, so a foreign id throws the same
   * 404 a missing id does (`SPEC-meal-service` Success Criterion 1).
   */
  async findOne(sub: string, id: string): Promise<SavedMealDto> {
    const row = await this.cache.one(sub, id, async () => {
      const meal = await this.meals.findOne({
        where: { id, ownerSub: sub, deletedAt: IsNull() },
      });
      if (!meal) throw new NotFoundException('Saved meal not found');
      const items = await this.loadItems(sub, meal.id);
      return toCachedSavedMealRow(meal, items);
    });
    const dek = await this.readDek(sub, [row]);
    return this.toDto(row, sub, dek);
  }

  /** The owner's non-trashed saved meals with their frozen items. */
  private async loadAll(sub: string): Promise<CachedSavedMealRow[]> {
    const meals = await this.meals.find({
      where: { ownerSub: sub, deletedAt: IsNull() },
      order: { updatedAt: 'DESC', id: 'ASC' },
    });
    return Promise.all(
      meals.map(async (meal) =>
        toCachedSavedMealRow(meal, await this.loadItems(sub, meal.id)),
      ),
    );
  }

  /** Frozen items for one saved meal, owner-scoped, stable order. */
  private loadItems(sub: string, savedMealId: string): Promise<SavedMealItem[]> {
    return this.items.find({
      where: { ownerSub: sub, savedMealId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  /**
   * Save the client's corrected snapshot. Every item is a **copy**: the service
   * never reads a food and never re-derives a nutrient, so the saved meal is
   * frozen the moment it is created. Bumps the owner generation AFTER the DB
   * write (a thrown save never bumps).
   */
  async create(sub: string, dto: CreateSavedMealDto): Promise<SavedMealDto> {
    const id = randomUUID();
    const dek = await this.keys.getOrCreateDek(sub);

    const meal = this.meals.create({
      id,
      ownerSub: sub,
      name: encryptField(dek, dto.name, savedMealNameAad(sub, id)),
      mealGroup: dto.mealGroup,
      version: 0,
      deletedAt: null,
    });
    const saved = await this.meals.save(meal);

    const itemEntities = dto.items.map((item) => {
      const itemId = randomUUID();
      return this.items.create({
        id: itemId,
        ownerSub: sub,
        savedMealId: saved.id,
        foodId: item.foodId ?? null,
        quantity: item.quantity,
        nutrients: this.sealVector(
          dek,
          this.requireVector(item.nutrients),
          savedMealItemAad(sub, itemId),
        ),
      });
    });
    const savedItems = await this.items.save(itemEntities);

    await this.cache.bump(sub);
    return this.toDto(toCachedSavedMealRow(saved, savedItems), sub, dek);
  }

  async remove(sub: string, id: string): Promise<void> {
    const meal = await this.meals.findOne({
      where: { id, ownerSub: sub, deletedAt: IsNull() },
    });
    if (!meal) throw new NotFoundException('Saved meal not found');
    meal.deletedAt = new Date();
    await this.meals.save(meal);
    await this.cache.bump(sub);
  }

  /**
   * Parse a client vector through the single completeness rule (one owner,
   * `foods/content.ts`). A partial or unknown nutrient field is a 400, not a
   * silently wrong snapshot.
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
