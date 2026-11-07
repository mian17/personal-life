import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { CryptoError, ENC_PREFIX, decryptField, encryptField } from '@life/crypto';
import { likeMatch } from '@life/shared';
import { scale, type Food as FoodModel, type NutrientVector } from '@life/nutrition';
import { DEFAULT_PAGE_LIMIT, KeysService, paginate, runAtomicBatch } from '@life/service-kit';
import { MEAL_CACHE, type MealCache } from '../cache/meal-cache';
import {
  completeVector,
  foodNameAad,
  foodNutrientsAad,
  readStoredVector,
  servingLabelAad,
  servingNutrientsAad,
  zeroVector,
} from './content';
import { Food, type FoodUnit } from './food.entity';
import { Serving } from './serving.entity';
import type { CreateFoodDto, ServingInputDto } from './dto/create-food.dto';
import type { UpdateFoodDto } from './dto/update-food.dto';
import { FoodsCache, toCachedFoodRow, type CachedFoodRow } from './foods-cache';

/** The wire shape of a serving: label, amount (in the food's unit), and its complete per-serving vector. */
export interface ServingDto {
  id: string;
  label: string;
  amount: number;
  nutrients: NutrientVector;
}

/**
 * The wire shape of a food. `ownerSub` is deliberately absent — ownership is
 * never echoed back to the client (mirrors `TargetDto`/note-service).
 */
export interface FoodDto {
  id: string;
  name: string;
  unit: FoodUnit;
  servingGrams: number;
  nutrients: NutrientVector;
  servings: ServingDto[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * One page of the owner's catalog plus the cursor that continues it. The
 * envelope key is the entity plural (`SPEC-pagination-seam` §4).
 */
export interface FoodPage {
  foods: FoodDto[];
  nextCursor: string | null;
}

/** What one catalog read is narrowed by; `limit`/`cursor` page it, the rest filter it. */
export interface ListFoodsOptions {
  /** Substring match over the **decrypted** name, applied after the cache hit. */
  q?: string;
  /** Include the soft-deleted rows a past entry or saved meal still names. */
  includeDeleted?: boolean;
  limit?: number;
  cursor?: string;
}

/**
 * The catalog's strictly-after test: `createdAt ASC, id ASC` (the loader's
 * order). `createdAt` is tie-prone — a batch create saves several foods in the
 * same millisecond — so `id` breaks the tie and the boundary can neither repeat
 * nor skip a row (`SPEC-pagination-seam` §3).
 */
function afterCatalogPosition(food: FoodDto, at: string[]): boolean {
  const [createdAt, id] = at;
  return food.createdAt > createdAt || (food.createdAt === createdAt && food.id > id);
}

/**
 * Derive a serving's own per-serving vector from the food's base vector. The
 * model's `scale()` owns the arithmetic (`SPEC-meal-service` Nutrient semantics);
 * this helper only adapts the row into the model's `Food` shape so the service
 * and the UI can never disagree on a number (lesson 0016 — one owner). The
 * amount is in the food's canonical unit, so the factor is `amount / servingGrams`.
 */
function servingVector(
  base: NutrientVector,
  servingGrams: number,
  amount: number,
): NutrientVector {
  const model: FoodModel = {
    id: 'derive',
    name: '',
    servingGrams,
    nutrients: base,
    portions: [],
  };
  return scale(model, amount / servingGrams);
}

/** Dedupe the portions a write carries (label+amount identity), preserving order. */
function normalizePortions(portions: ServingInputDto[] | undefined): ServingInputDto[] {
  const seen = new Set<string>();
  const out: ServingInputDto[] = [];
  for (const portion of portions ?? []) {
    const key = portion.label + ' ' + portion.amount;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: portion.label, amount: portion.amount });
  }
  return out;
}

/**
 * Owner-scoped food catalog (`SPEC-meal-service` foods / Success Criterion 1).
 *
 * Three rules hold everywhere below:
 * - `ownerSub` is the caller's `sub`, supplied by the controller from
 *   `@Principal()`; it is a predicate on every read and write, and a foreign id
 *   is indistinguishable from a missing one (same 404).
 * - Content (`name`, the base vector, each serving's `label` + vector) is sealed
 *   with byte-exact AAD (`content.ts`) before it reaches the DB or the cache.
 * - Reads go `cache → loader`; writes go `BE → DB → bump`. The cache holds rows
 *   as persisted, so decrypt and the `q` search always run after a hit.
 */
@Injectable()
export class FoodsService {
  private readonly logger = new Logger(FoodsService.name);

  constructor(
    @InjectRepository(Food) private readonly foods: Repository<Food>,
    @InjectRepository(Serving) private readonly servings: Repository<Serving>,
    private readonly cache: FoodsCache,
    private readonly keys: KeysService,
    // Optional only so the unit suites that build this service positionally keep
    // compiling; `FoodsModule` always provides the token, so a batch always has
    // the service's one cache adapter to bump.
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
    return this.foods.manager.connection;
  }

  /**
   * Decrypt-or-passthrough (`SPEC-meal-service` Code Style, mirroring
   * note-service): an `enc.v1.` value is opened against its AAD; anything else
   * is a legacy plaintext row that passes through. A decrypt failure is
   * fail-closed — an ids-only log line, then the typed error is rethrown, never
   * ciphertext or garbage on the wire.
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
  private readDek(sub: string, rows: CachedFoodRow[]): Promise<Buffer | null> {
    const sealed = (stored: string | null) =>
      typeof stored === 'string' && stored.startsWith(ENC_PREFIX);
    const needs = rows.some(
      (row) =>
        sealed(row.name) ||
        sealed(row.nutrients) ||
        row.servings.some((s) => sealed(s.label) || sealed(s.nutrients)),
    );
    if (!needs) return Promise.resolve(null);
    return this.keys.getDekForRead(sub);
  }

  /** Assemble the wire DTO from a stored row; every content field is opened here. */
  private toDto(row: CachedFoodRow, sub: string, dek: Buffer | null): FoodDto {
    const nutrients = row.nutrients
      ? readStoredVector(this.openField(row.nutrients, dek, foodNutrientsAad(sub, row.id), row.id))
      : zeroVector();
    return {
      id: row.id,
      name: this.openField(row.name, dek, foodNameAad(sub, row.id), row.id),
      unit: row.unit,
      servingGrams: row.servingGrams,
      nutrients,
      servings: row.servings.map((serving) => ({
        id: serving.id,
        label: this.openField(serving.label, dek, servingLabelAad(sub, serving.id), serving.id),
        amount: serving.grams,
        nutrients: readStoredVector(
          this.openField(serving.nutrients, dek, servingNutrientsAad(sub, serving.id), serving.id),
        ),
      })),
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Every row the owner has, soft-deleted included, in the catalog's stable
   * order (`createdAt` ASC, `id` ASC tie-break). Metadata-only predicate: the
   * name is an envelope, so no content ever reaches SQL.
   *
   * The `deletedAt` predicate is deliberately absent: an id-only join from a
   * past entry or a saved-meal item must resolve the dish name of a food the
   * owner has since deleted, and the active-vs-all choice is a consumer filter
   * applied after the hit (`SPEC-meal-service` Cache Rules: one entry serves
   * every variant).
   */
  private async loadRows(sub: string): Promise<CachedFoodRow[]> {
    const found = await this.foods.find({
      where: { ownerSub: sub },
      relations: { servings: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return found.map((food) => {
      food.servings.sort((a, b) => a.id.localeCompare(b.id));
      return toCachedFoodRow(food);
    });
  }

  /**
   * The owner's whole catalog matching `q`, optionally including the soft-deleted
   * rows — the single ordered read both list callers build on.
   *
   * Key `meal:<sub>:v<gen>:food:list`. The cached value is the whole ciphertext
   * row set — trashed rows included — so neither `q` nor the active-vs-all
   * choice enters the key and one entry serves every variant. **Search runs
   * post-decrypt, in memory** (`likeMatch` over the decrypted name) — never
   * `LIKE` over the encrypted column (`SPEC-meal-service` Cache Rules).
   *
   * `includeDeleted` exists because a soft-deleted food still names the past
   * entries and saved-meal items that logged it (`SPEC-food-catalog-ui` AC5):
   * the id-only join has nowhere else to read the name from.
   *
   * This is the whole set, not a page: the photo tool loop ranks every match
   * (`photo.service.ts` `searchFood`), so narrowing it to one page would silently
   * make the model see a subset of the catalog. `findAll` pages over the same
   * result, which is what keeps the two readers one query path.
   */
  async findMatching(sub: string, q?: string, includeDeleted = false): Promise<FoodDto[]> {
    const rows = await this.cache.list(sub, () => this.loadRows(sub));
    const selected = includeDeleted ? rows : rows.filter((row) => row.deletedAt === null);
    const dek = await this.readDek(sub, selected);
    const decoded = selected.map((row) => this.toDto(row, sub, dek));
    if (!q) return decoded;
    return decoded.filter((food) => likeMatch(food.name, '%' + q + '%'));
  }

  /**
   * One page of `GET /api/foods`, in the catalog's order (`createdAt ASC,
   * id ASC`). The page is a projection of `findMatching`'s whole filtered set,
   * so `limit`/`cursor` never reach the cache key and one entry serves every page
   * of every search variant (`SPEC-pagination-seam` §6).
   */
  async findAll(sub: string, opts: ListFoodsOptions = {}): Promise<FoodPage> {
    const matching = await this.findMatching(sub, opts.q, opts.includeDeleted);
    const page = paginate(matching, {
      limit: opts.limit ?? DEFAULT_PAGE_LIMIT,
      cursor: opts.cursor,
      keyOf: (food) => [food.createdAt, food.id],
      after: afterCatalogPosition,
    });
    return { foods: page.rows, nextCursor: page.nextCursor };
  }

  /**
   * One food by id. Key `meal:<sub>:v<gen>:food:one:<id>`.
   *
   * The loader's `where` carries `ownerSub`, so a foreign id throws the same 404
   * a missing id does: a second owner cannot probe for existence, let alone read
   * the row (`SPEC-meal-service` Success Criterion 1).
   */
  async findOne(sub: string, id: string): Promise<FoodDto> {
    const row = await this.cache.one(sub, id, async () => {
      const food = await this.foods.findOne({
        where: { id, ownerSub: sub, deletedAt: IsNull() },
        relations: { servings: true },
      });
      if (!food) throw new NotFoundException('Food not found');
      food.servings.sort((a, b) => a.id.localeCompare(b.id));
      return toCachedFoodRow(food);
    });
    const dek = await this.readDek(sub, [row]);
    return this.toDto(row, sub, dek);
  }

  /** `POST /api/foods` — 201 with the sealed catalog row. */
  async create(sub: string, dto: CreateFoodDto): Promise<FoodDto> {
    const food = await this.insertOne(this.foods.manager, sub, dto);
    // Bump AFTER the mutation: pre-write reads were born under the old
    // generation and die here; a thrown save never bumps.
    await this.cache.bump(sub);
    return food;
  }

  /** The `foods` batch create: one transaction, submission order, one bump (§5). */
  async createMany(sub: string, items: CreateFoodDto[]): Promise<FoodDto[]> {
    return runAtomicBatch({
      items,
      sub,
      dataSource: this.writeDataSource,
      cache: this.requireMealCache(),
      runItem: (item, manager) => this.insertOne(manager, sub, item),
    });
  }

  /**
   * One food's insert plus its serving rows, through the manager the caller
   * supplies, and with no bump. Every write here — the food row and each
   * serving — goes through `manager`, so a batch's nested servings roll back
   * with their food.
   */
  private async insertOne(
    manager: EntityManager | undefined,
    sub: string,
    dto: CreateFoodDto,
  ): Promise<FoodDto> {
    const foods = this.foodsFor(manager);
    // Service-generated id: the AAD binds it, so it exists before the ciphertext.
    const id = randomUUID();
    const dek = await this.keys.getOrCreateDek(sub);
    const base = dto.nutrients === undefined ? null : this.requireVector(dto.nutrients);

    const food = foods.create({
      id,
      ownerSub: sub,
      name: encryptField(dek, dto.name, foodNameAad(sub, id)),
      unit: dto.unit ?? 'g',
      servingGrams: dto.servingGrams,
      nutrients: base === null ? null : this.sealVector(dek, base, foodNutrientsAad(sub, id)),
      version: 0,
      deletedAt: null,
    });
    const saved = await foods.save(food);
    const servings = await this.replaceServings(
      manager,
      sub,
      saved,
      base ?? zeroVector(),
      normalizePortions(dto.portions),
      dek,
    );
    return this.toDto(toCachedFoodRow({ ...saved, servings }), sub, dek);
  }

  /** `PATCH /api/foods/:id` — a stale `expectedVersion` is a 409. */
  async update(sub: string, id: string, dto: UpdateFoodDto): Promise<FoodDto> {
    const food = await this.updateOne(this.foods.manager, sub, id, dto);
    await this.cache.bump(sub);
    return food;
  }

  /**
   * The `foods` batch update: one transaction, submission order, one bump. A
   * stale `expectedVersion` or one invalid nutrient vector rolls the whole batch
   * back.
   */
  async updateMany(
    sub: string,
    items: (UpdateFoodDto & { id: string })[]
  ): Promise<FoodDto[]> {
    return runAtomicBatch({
      items,
      sub,
      dataSource: this.writeDataSource,
      cache: this.requireMealCache(),
      runItem: (item, manager) => this.updateOne(manager, sub, item.id, item),
    });
  }

  /**
   * One food's patch plus its serving set, through the manager the caller
   * supplies, and with no bump.
   */
  private async updateOne(
    manager: EntityManager | undefined,
    sub: string,
    id: string,
    dto: UpdateFoodDto,
  ): Promise<FoodDto> {
    const foods = this.foodsFor(manager);
    const food = await foods.findOne({ where: { id, ownerSub: sub, deletedAt: IsNull() } });
    if (!food) throw new NotFoundException('Food not found');
    this.rejectStaleVersion(food, dto.expectedVersion);

    const dek = await this.keys.getOrCreateDek(sub);
    const base = dto.nutrients === undefined ? null : this.requireVector(dto.nutrients);

    if (dto.name !== undefined) food.name = encryptField(dek, dto.name, foodNameAad(sub, food.id));
    if (dto.servingGrams !== undefined) food.servingGrams = dto.servingGrams;
    // A PATCH that omits `nutrients` leaves the stored base vector untouched:
    // writing NULL here would erase the food's numbers on a name-only edit (a
    // NULL base reads back as all zeroes). Only an explicit vector replaces it.
    const baseChanged = base !== null;
    if (baseChanged) {
      food.nutrients = this.sealVector(dek, base, foodNutrientsAad(sub, food.id));
    }

    food.version += 1;
    const saved = await foods.save(food);
    const servings = await this.reconcileServings(manager, sub, saved, base, baseChanged, dto, dek);
    return this.toDto(toCachedFoodRow({ ...saved, servings }), sub, dek);
  }

  /**
   * The serving set a patch leaves behind: replaced when the client sends one,
   * re-derived when the vector or serving weight moved, otherwise untouched — so
   * a serving can never disagree with the food it belongs to.
   */
  private async reconcileServings(
    manager: EntityManager | undefined,
    sub: string,
    food: Food,
    base: NutrientVector | null,
    baseChanged: boolean,
    dto: UpdateFoodDto,
    dek: Buffer,
  ): Promise<Serving[]> {
    if (dto.portions !== undefined) {
      if (base === null) {
        throw new BadRequestException('nutrients are required to replace portions');
      }
      return this.replaceServings(manager, sub, food, base, normalizePortions(dto.portions), dek);
    }
    if (baseChanged || dto.servingGrams !== undefined) {
      // Re-deriving a changed base needs the vector, so a PATCH that moves
      // `servingGrams` without `nutrients` reuses the food's stored base.
      const effectiveBase = base ?? this.storedBaseVector(sub, food, dek);
      return this.deriveServings(manager, sub, food, effectiveBase, dek);
    }
    return this.readServings(manager, sub, food);
  }

  /** `DELETE /api/foods/:id` — soft delete; the row stays readable by id only. */
  async remove(sub: string, id: string): Promise<void> {
    await this.softDeleteOne(this.foods.manager, sub, id);
    await this.cache.bump(sub);
  }

  /**
   * The `foods` batch delete: one transaction, submission order, one bump, and
   * the singular route's soft-delete meaning. A foreign id is a 404 and rolls
   * the whole batch back.
   */
  async removeMany(sub: string, items: { id: string }[]): Promise<{ deleted: string[] }> {
    const deleted = await runAtomicBatch({
      items,
      sub,
      dataSource: this.writeDataSource,
      cache: this.requireMealCache(),
      runItem: async (item, manager) => {
        await this.softDeleteOne(manager, sub, item.id);
        return item.id;
      },
    });
    return { deleted };
  }

  /**
   * One food's move out of the active list, through the manager the caller
   * supplies, and with no bump. Soft by definition, mirroring the singular
   * delete: the row keeps naming past entries and saved-meal items.
   */
  private async softDeleteOne(
    manager: EntityManager | undefined,
    sub: string,
    id: string,
  ): Promise<void> {
    const foods = this.foodsFor(manager);
    const food = await foods.findOne({ where: { id, ownerSub: sub, deletedAt: IsNull() } });
    if (!food) throw new NotFoundException('Food not found');
    food.deletedAt = new Date();
    await foods.save(food);
  }

  /**
   * The food repository a write runs against. A manager means "inside this
   * transaction", and every write a batch performs must go through it. No
   * manager means the service's own repository — the singular path, and the only
   * shape a unit suite's repository double can supply.
   */
  private foodsFor(manager: EntityManager | undefined): Repository<Food> {
    if (!manager) return this.foods;
    return manager.getRepository(Food);
  }

  /** The serving repository a write runs against, under the same rule as `foodsFor`. */
  private servingsFor(manager: EntityManager | undefined): Repository<Serving> {
    if (!manager) return this.servings;
    return manager.getRepository(Serving);
  }

  /** Optimistic concurrency: an explicit version that no longer matches is a 409. */
  private rejectStaleVersion(food: Food, expectedVersion: number | undefined): void {
    if (expectedVersion === undefined || food.version === expectedVersion) return;
    throw new ConflictException('Food was modified');
  }

  /** The rows a patch leaves alone, read through the caller's manager. */
  private async readServings(
    manager: EntityManager | undefined,
    sub: string,
    food: Food,
  ): Promise<Serving[]> {
    const servings = await this.servingsFor(manager).find({
      where: { foodId: food.id, ownerSub: sub },
    });
    servings.sort((a, b) => a.id.localeCompare(b.id));
    return servings;
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

  /**
   * Replace a food's serving set with `portions`, re-deriving every row's vector
   * from the food's base vector (`servingVector` — one owner for the arithmetic).
   * Existing rows are deleted and re-inserted, which keeps this one code path
   * instead of an insert/update/delete matrix.
   */
  private async replaceServings(
    manager: EntityManager | undefined,
    sub: string,
    food: Food,
    base: NutrientVector,
    portions: ServingInputDto[],
    dek: Buffer,
  ): Promise<Serving[]> {
    const servings = this.servingsFor(manager);
    const existing = await servings.find({ where: { foodId: food.id, ownerSub: sub } });
    if (existing.length > 0) await servings.delete({ foodId: food.id, ownerSub: sub });

    const rows = portions.map((portion) => {
      const servingId = randomUUID();
      return servings.create({
        id: servingId,
        ownerSub: sub,
        foodId: food.id,
        label: encryptField(dek, portion.label, servingLabelAad(sub, servingId)),
        // Wire `amount` → the persisted `grams` column (`Food.unit` says which
        // unit that amount is): `ponytail:` rename the column with the next
        // migration, no behavior change until then.
        grams: portion.amount,
        nutrients: this.sealVector(
          dek,
          servingVector(base, food.servingGrams, portion.amount),
          servingNutrientsAad(sub, servingId),
        ),
      });
    });
    // `insert()` reuses one entity reference for bulk rows, crossing ids
    // between in-memory rows (~40% of multi-portion writes); the DB stays
    // correct but the returned DTO is built from the crossed copies. `save()`
    // keeps each row's id with its ciphertext. Small batch, fine per write.
    if (rows.length > 0) await servings.save(rows);
    rows.sort((a, b) => a.id.localeCompare(b.id));
    return rows;
  }

  /**
   * The food's current base vector, decrypted, for a PATCH that moved
   * `servingGrams` or supplied a new vector without a `portions` replacement.
   * An all-zero base (a food created before any vector was set) yields all-zero
   * servings, which is the model's documented "absent data is 0" case.
   */
  private storedBaseVector(sub: string, food: Food, dek: Buffer): NutrientVector {
    if (!food.nutrients) return zeroVector();
    return readStoredVector(this.openField(food.nutrients, dek, foodNutrientsAad(sub, food.id), food.id));
  }

  /**
   * Re-derive every existing serving's own vector from `base` and the food's
   * current `servingGrams`, keeping the rows' ids, labels, and grams. Used when
   * the base vector or serving weight changed but the client did not send a new
   * `portions` set, so a serving can never serve a stale number.
   */
  private async deriveServings(
    manager: EntityManager | undefined,
    sub: string,
    food: Food,
    base: NutrientVector,
    dek: Buffer,
  ): Promise<Serving[]> {
    const servings = this.servingsFor(manager);
    const existing = await servings.find({ where: { foodId: food.id, ownerSub: sub } });
    for (const serving of existing) {
      serving.nutrients = this.sealVector(
        dek,
        servingVector(base, food.servingGrams, serving.grams),
        servingNutrientsAad(sub, serving.id),
      );
    }
    if (existing.length > 0) await servings.save(existing);
    existing.sort((a, b) => a.id.localeCompare(b.id));
    return existing;
  }
}
