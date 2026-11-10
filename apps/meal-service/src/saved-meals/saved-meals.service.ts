import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { CryptoError, ENC_PREFIX, decryptField, encryptField } from '@life/crypto';
import type { NutrientVector } from '@life/nutrition';
import { DEFAULT_PAGE_LIMIT, KeysService, paginate, runAtomicBatch } from '@life/service-kit';
import { MEAL_CACHE, type MealCache } from '../cache/meal-cache.js';
import {
  softDeleteBatch,
  softDeleteOne,
  type SoftDeleteTarget,
} from '../batch/soft-delete-batch.js';
import { completeVector, readStoredVector } from '../foods/content.js';
import type { MealGroup } from '../entries/dto/create-entry.dto.js';
import { SavedMeal } from './saved-meal.entity.js';
import { SavedMealItem } from './saved-meal-item.entity.js';
import type { CreateSavedMealDto } from './dto/create-saved-meal.dto.js';
import {
  SavedMealsCache,
  toCachedSavedMealRow,
  type CachedSavedMealItemRow,
  type CachedSavedMealRow,
} from './saved-meals-cache.js';

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
 * One page of the owner's saved meals plus the cursor that continues it. The
 * envelope key is the entity plural (`SPEC-pagination-seam` §4).
 */
export interface SavedMealPage {
  savedMeals: SavedMealDto[];
  nextCursor: string | null;
  /** How many rows the whole filtered set holds — never this page's length. */
  total: number;
}

/**
 * The list's strictly-after test: `updatedAt DESC, id ASC` (the loader's order —
 * edits surface first). `id` breaks an `updatedAt` tie, so the boundary can
 * neither repeat nor skip a row (`SPEC-pagination-seam` §3).
 */
function afterSavedMealPosition(meal: SavedMealDto, at: string[]): boolean {
  const [updatedAt, id] = at;
  return meal.updatedAt < updatedAt || (meal.updatedAt === updatedAt && meal.id > id);
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
    // Optional only so the unit suites that build this service positionally keep
    // compiling; `SavedMealsModule` always provides the token, so a batch always
    // has the service's one cache adapter to bump.
    @Inject(MEAL_CACHE) private readonly mealCache?: MealCache,
  ) {}

  /**
   * The service's one cache adapter, as the batch kernel types it. The resource
   * cache helper composes the adapter rather than extending it, so a batch hands
   * the kernel the adapter itself — one bump then invalidates this owner's whole
   * read set (`SPEC-meal-service.md` §6).
   *
   * The module always provides the token, so this never throws under Nest; the
   * typed throw only guards a hand-built service in a unit suite.
   */
  private requireMealCache(): MealCache {
    if (!this.mealCache) {
      throw new Error('MEAL_CACHE is unavailable: the batch cache adapter is not wired');
    }
    return this.mealCache;
  }

  /**
   * The datasource a batch opens its one transaction on — the same DB the writes
   * go to, taken from the injected repository instead of a fifth constructor
   * argument so the existing suites that build this service positionally keep
   * compiling.
   *
   * ponytail: upgrade path is `@InjectDataSource()` once those suites are
   * converted to a Nest testing module.
   */
  private get writeDataSource() {
    return this.meals.manager.connection;
  }

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

  private toItemDto(
    item: CachedSavedMealItemRow,
    sub: string,
    dek: Buffer | null,
  ): SavedMealItemDto {
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
   * One page of the owner's non-trashed saved meals, newest-first.
   * Key `meal:<sub>:v<gen>:saved:list` — one entry serves every list read, and
   * `limit`/`cursor` page it post-hit so neither ever enters the key.
   */
  async findAll(
    sub: string,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<SavedMealPage> {
    const rows = await this.cache.list(sub, () => this.loadAll(sub));
    const dek = await this.readDek(sub, rows);
    const decoded = rows.map((row) => this.toDto(row, sub, dek));
    const page = paginate(decoded, {
      limit: opts.limit ?? DEFAULT_PAGE_LIMIT,
      cursor: opts.cursor,
      keyOf: (meal) => [meal.updatedAt, meal.id],
      after: afterSavedMealPosition,
    });
    return { savedMeals: page.rows, nextCursor: page.nextCursor, total: page.total };
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
      meals.map(async (meal) => toCachedSavedMealRow(meal, await this.loadItems(sub, meal.id))),
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
    const meal = await this.insertOne(this.meals.manager, sub, dto);
    await this.cache.bump(sub);
    return meal;
  }

  /**
   * The `saved-meals` batch create: one transaction, submission order, one bump.
   * Ten meals of ten items each is 110 rows and still commits or rolls back
   * whole (§5).
   */
  async createMany(sub: string, items: CreateSavedMealDto[]): Promise<SavedMealDto[]> {
    return runAtomicBatch({
      items,
      sub,
      dataSource: this.writeDataSource,
      cache: this.requireMealCache(),
      runItem: (item, manager) => this.insertOne(manager, sub, item),
    });
  }

  /**
   * One saved meal's insert plus its frozen item rows, through the manager the
   * caller supplies, and with no bump. Every write here — the meal row and each
   * frozen item — goes through `manager`, so a batch's items roll back with
   * their meal.
   */
  private async insertOne(
    manager: EntityManager | undefined,
    sub: string,
    dto: CreateSavedMealDto,
  ): Promise<SavedMealDto> {
    const meals = this.mealsFor(manager);
    const items = this.itemsFor(manager);
    const id = randomUUID();
    const dek = await this.keys.getOrCreateDek(sub);

    const meal = meals.create({
      id,
      ownerSub: sub,
      name: encryptField(dek, dto.name, savedMealNameAad(sub, id)),
      mealGroup: dto.mealGroup,
      version: 0,
      deletedAt: null,
    });
    const saved = await meals.save(meal);
    const savedItems = await items.save(this.frozenItems(sub, saved.id, dto, dek, items));
    return this.toDto(toCachedSavedMealRow(saved, savedItems), sub, dek);
  }

  /** One saved meal's item rows, sealed from the client's corrected values. */
  private frozenItems(
    sub: string,
    savedMealId: string,
    dto: CreateSavedMealDto,
    dek: Buffer,
    items: Repository<SavedMealItem>,
  ): SavedMealItem[] {
    return dto.items.map((item) => {
      const itemId = randomUUID();
      return items.create({
        id: itemId,
        ownerSub: sub,
        savedMealId,
        foodId: item.foodId ?? null,
        quantity: item.quantity,
        nutrients: this.sealVector(
          dek,
          this.requireVector(item.nutrients),
          savedMealItemAad(sub, itemId),
        ),
      });
    });
  }

  /** `DELETE /api/saved-meals/:id` — soft delete; the meal leaves every read. */
  async remove(sub: string, id: string): Promise<void> {
    await softDeleteOne(this.trashable, this.meals.manager, sub, id);
    await this.cache.bump(sub);
  }

  /**
   * The `saved-meals` batch delete: one transaction, submission order, one bump,
   * and the singular route's soft-delete meaning. A foreign id is a 404 and
   * rolls the whole batch back.
   */
  removeMany(sub: string, items: { id: string }[]): Promise<{ deleted: string[] }> {
    return softDeleteBatch(this.trashable, {
      items,
      sub,
      dataSource: this.writeDataSource,
      cache: this.requireMealCache(),
    });
  }

  /**
   * What the shared soft delete needs to know about a saved meal, stated once for
   * both the singular and the batch path: where a meal lives, and what a missing
   * one is called. The frozen item rows stay with the trashed meal.
   */
  private readonly trashable: SoftDeleteTarget<SavedMeal> = {
    repositoryFor: (manager) => this.mealsFor(manager),
    notFound: 'Saved meal not found',
  };

  /**
   * The saved-meal repository a write runs against. A manager means "inside this
   * transaction", and every write a batch performs must go through it. No
   * manager means the service's own repository — the singular path, and the only
   * shape a unit suite's repository double can supply.
   */
  private mealsFor(manager: EntityManager | undefined): Repository<SavedMeal> {
    if (!manager) return this.meals;
    return manager.getRepository(SavedMeal);
  }

  /** The frozen-item repository a write runs against, under the same rule. */
  private itemsFor(manager: EntityManager | undefined): Repository<SavedMealItem> {
    if (!manager) return this.items;
    return manager.getRepository(SavedMealItem);
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
