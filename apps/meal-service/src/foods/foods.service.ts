import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { CryptoError, ENC_PREFIX, decryptField, encryptField } from '@life/crypto';
import { likeMatch } from '@life/shared';
import { scale, type Food as FoodModel, type NutrientVector } from '@life/nutrition';
import { KeysService } from '../keys/keys.service';
import {
  completeVector,
  foodNameAad,
  foodNutrientsAad,
  readStoredVector,
  servingLabelAad,
  servingNutrientsAad,
  zeroVector,
} from './content';
import { Food } from './food.entity';
import { Serving } from './serving.entity';
import type { CreateFoodDto, ServingInputDto } from './dto/create-food.dto';
import type { UpdateFoodDto } from './dto/update-food.dto';
import { FoodsCache, toCachedFoodRow, toCachedServing, type CachedFoodRow } from './foods-cache';

/** The wire shape of a serving: label, grams, and its complete per-serving vector. */
export interface ServingDto {
  id: string;
  label: string;
  grams: number;
  nutrients: NutrientVector;
}

/**
 * The wire shape of a food. `ownerSub` is deliberately absent — ownership is
 * never echoed back to the client (mirrors `TargetDto`/note-service).
 */
export interface FoodDto {
  id: string;
  name: string;
  servingGrams: number;
  nutrients: NutrientVector;
  servings: ServingDto[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Derive a serving's own per-serving vector from the food's base vector. The
 * model's `scale()` owns the arithmetic (`SPEC-meal-service` Nutrient semantics);
 * this helper only adapts the row into the model's `Food` shape so the service
 * and the UI can never disagree on a number (lesson 0016 — one owner).
 */
function servingVector(
  base: NutrientVector,
  servingGrams: number,
  serving: { grams: number },
): NutrientVector {
  const model: FoodModel = {
    id: 'derive',
    name: '',
    servingGrams,
    nutrients: base,
    portions: [],
  };
  return scale(model, serving.grams / servingGrams);
}

/** Dedupe the portions a write carries (label+grams identity), preserving order. */
function normalizePortions(portions: ServingInputDto[] | undefined): ServingInputDto[] {
  const seen = new Set<string>();
  const out: ServingInputDto[] = [];
  for (const portion of portions ?? []) {
    const key = portion.label + ' ' + portion.grams;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: portion.label, grams: portion.grams });
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
  ) {}

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
  private async readDek(sub: string, rows: CachedFoodRow[]): Promise<Buffer | null> {
    const sealed = (stored: string | null) =>
      typeof stored === 'string' && stored.startsWith(ENC_PREFIX);
    const needs = rows.some(
      (row) =>
        sealed(row.name) ||
        sealed(row.nutrients) ||
        row.servings.some((s) => sealed(s.label) || sealed(s.nutrients)),
    );
    if (!needs) return null;
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
      servingGrams: row.servingGrams,
      nutrients,
      servings: row.servings.map((serving) => ({
        id: serving.id,
        label: this.openField(serving.label, dek, servingLabelAad(sub, serving.id), serving.id),
        grams: serving.grams,
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
   * The owner's non-trashed rows, in the catalog's stable order (`createdAt`
   * ASC, `id` ASC tie-break). Metadata-only predicate: the name is an envelope,
   * so no content ever reaches SQL.
   */
  private async loadRows(sub: string): Promise<CachedFoodRow[]> {
    const found = await this.foods.find({
      where: { ownerSub: sub, deletedAt: IsNull() },
      relations: { servings: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return found.map((food) => {
      food.servings.sort((a, b) => a.id.localeCompare(b.id));
      return toCachedFoodRow(food);
    });
  }

  /**
   * The owner's foods, optionally filtered by `q`.
   *
   * Key `meal:<sub>:v<gen>:food:list`. The cached value is the whole non-trashed
   * ciphertext row set, so `q` never enters the key and one entry serves every
   * search variant. **Search runs post-decrypt, in memory** (`likeMatch` over
   * the decrypted name) — never `LIKE` over the encrypted column
   * (`SPEC-meal-service` Cache Rules).
   */
  async findAll(sub: string, q?: string): Promise<FoodDto[]> {
    const rows = await this.cache.list(sub, () => this.loadRows(sub));
    const dek = await this.readDek(sub, rows);
    const decoded = rows.map((row) => this.toDto(row, sub, dek));
    if (!q) return decoded;
    return decoded.filter((food) => likeMatch(food.name, '%' + q + '%'));
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

  async create(sub: string, dto: CreateFoodDto): Promise<FoodDto> {
    // Service-generated id: the AAD binds it, so it exists before the ciphertext.
    const id = randomUUID();
    const dek = await this.keys.getOrCreateDek(sub);
    const base = dto.nutrients === undefined ? null : this.requireVector(dto.nutrients);

    const food = this.foods.create({
      id,
      ownerSub: sub,
      name: encryptField(dek, dto.name, foodNameAad(sub, id)),
      servingGrams: dto.servingGrams,
      nutrients: base === null ? null : this.sealVector(dek, base, foodNutrientsAad(sub, id)),
      version: 0,
      deletedAt: null,
    });
    const saved = await this.foods.save(food);
    const servings = await this.replaceServings(
      sub,
      saved,
      base ?? zeroVector(),
      normalizePortions(dto.portions),
      dek,
    );

    // Bump AFTER the mutation: pre-write reads were born under the old
    // generation and die here; a thrown save never bumps.
    await this.cache.bump(sub);
    return this.toDto(
      { ...toCachedFoodRow(saved), servings: servings.map(toCachedServing) },
      sub,
      dek,
    );
  }

  async update(sub: string, id: string, dto: UpdateFoodDto): Promise<FoodDto> {
    const food = await this.foods.findOne({ where: { id, ownerSub: sub, deletedAt: IsNull() } });
    if (!food) throw new NotFoundException('Food not found');
    if (dto.expectedVersion !== undefined && food.version !== dto.expectedVersion) {
      throw new ConflictException('Food was modified');
    }

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
    const saved = await this.foods.save(food);

    // The serving set is replaced when the client sends one, re-derived when the
    // vector or serving weight moved, and otherwise left untouched — so a
    // serving can never disagree with the food it belongs to. Re-deriving a
    // changed base needs the vector, so a PATCH that moves `servingGrams`
    // without `nutrients` reuses the food's stored base (decrypted once here).
    let servings: Serving[];
    if (dto.portions !== undefined) {
      if (base === null) {
        throw new BadRequestException('nutrients are required to replace portions');
      }
      servings = await this.replaceServings(sub, saved, base, normalizePortions(dto.portions), dek);
    } else if (baseChanged || dto.servingGrams !== undefined) {
      const effectiveBase = base ?? (await this.storedBaseVector(sub, saved, dek));
      servings = await this.deriveServings(sub, saved, effectiveBase, dek);
    } else {
      servings = await this.servings.find({ where: { foodId: saved.id, ownerSub: sub } });
      servings.sort((a, b) => a.id.localeCompare(b.id));
    }

    await this.cache.bump(sub);
    return this.toDto(
      { ...toCachedFoodRow(saved), servings: servings.map(toCachedServing) },
      sub,
      dek,
    );
  }

  async remove(sub: string, id: string): Promise<void> {
    const food = await this.foods.findOne({ where: { id, ownerSub: sub, deletedAt: IsNull() } });
    if (!food) throw new NotFoundException('Food not found');
    food.deletedAt = new Date();
    await this.foods.save(food);
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

  /**
   * Replace a food's serving set with `portions`, re-deriving every row's vector
   * from the food's base vector (`servingVector` — one owner for the arithmetic).
   * Existing rows are deleted and re-inserted, which keeps this one code path
   * instead of an insert/update/delete matrix.
   */
  private async replaceServings(
    sub: string,
    food: Food,
    base: NutrientVector,
    portions: ServingInputDto[],
    dek: Buffer,
  ): Promise<Serving[]> {
    const existing = await this.servings.find({ where: { foodId: food.id, ownerSub: sub } });
    if (existing.length > 0) await this.servings.delete({ foodId: food.id, ownerSub: sub });

    const rows = portions.map((portion) => {
      const servingId = randomUUID();
      return this.servings.create({
        id: servingId,
        ownerSub: sub,
        foodId: food.id,
        label: encryptField(dek, portion.label, servingLabelAad(sub, servingId)),
        grams: portion.grams,
        nutrients: this.sealVector(
          dek,
          servingVector(base, food.servingGrams, portion),
          servingNutrientsAad(sub, servingId),
        ),
      });
    });
    if (rows.length > 0) await this.servings.insert(rows);
    rows.sort((a, b) => a.id.localeCompare(b.id));
    return rows;
  }

  /**
   * The food's current base vector, decrypted, for a PATCH that moved
   * `servingGrams` or supplied a new vector without a `portions` replacement.
   * An all-zero base (a food created before any vector was set) yields all-zero
   * servings, which is the model's documented "absent data is 0" case.
   */
  private async storedBaseVector(sub: string, food: Food, dek: Buffer): Promise<NutrientVector> {
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
    sub: string,
    food: Food,
    base: NutrientVector,
    dek: Buffer,
  ): Promise<Serving[]> {
    const existing = await this.servings.find({ where: { foodId: food.id, ownerSub: sub } });
    for (const serving of existing) {
      serving.nutrients = this.sealVector(
        dek,
        servingVector(base, food.servingGrams, serving),
        servingNutrientsAad(sub, serving.id),
      );
    }
    if (existing.length > 0) await this.servings.save(existing);
    existing.sort((a, b) => a.id.localeCompare(b.id));
    return existing;
  }
}
