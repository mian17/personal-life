import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ENC_PREFIX, decryptField, encryptField } from '@life/crypto';
import { KeysService } from '@life/service-kit';
import { MEDITATION_CACHE, type MeditationCache } from '../cache/meditation-cache.js';
import { clampGoal, clampPlannedMinutes } from './goal.js';
import { Settings } from './settings.entity.js';
import { DEFAULT_SETTINGS, type SettingsContent, type SettingsDto } from './settings.dto.js';

/**
 * Field AAD for the settings envelope, byte-exact and uniform: the identical string
 * is rebuilt at encrypt and decrypt, and the owner's `sub` is in it, so one owner's
 * envelope cannot be replayed as another's.
 */
function settingsAad(ownerSub: string): string {
  return `life.v1|${ownerSub}|meditation|settings`;
}

/** A settings row as stored — the shape the cache holds, ciphertext and all. */
interface CachedSettingsRow {
  ownerSub: string;
  content: string;
}

function toCachedRow(ownerSub: string, content: SettingsContent, dek: Buffer): CachedSettingsRow {
  return {
    ownerSub,
    content: encryptField(dek, JSON.stringify(content), settingsAad(ownerSub)),
  };
}

/** A hit is only usable when it carries the envelope; a plaintext entry is a miss. */
function isCiphertextSettingsRow(row: CachedSettingsRow | null): boolean {
  return row === null || row.content.startsWith(ENC_PREFIX);
}

function decodeSettingsContent(row: CachedSettingsRow, dek: Buffer): SettingsContent {
  if (!row.content.startsWith(ENC_PREFIX)) throw new Error('settings entry is not ciphertext');
  const plaintext = decryptField(dek, row.content, settingsAad(row.ownerSub));
  return JSON.parse(plaintext) as SettingsContent;
}

/**
 * The owner's settings (`SPEC-meditation-app` §1): the daily goal, the planned
 * sitting length, and the interval-bell configuration — one row per owner, read
 * through the shared cache and written straight to the database.
 *
 * Reads go `cache → database`: the loader inside `getThrough` is the only place that
 * touches the repository, and it reads the ciphertext row as persisted. Writes go
 * `database → generation bump`, so a read landing mid-write cannot repopulate the
 * new generation with pre-write settings. Decryption happens after the hit, never
 * inside the cache.
 */
@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(Settings) private readonly settings: Repository<Settings>,
    @Inject(MEDITATION_CACHE) private readonly cache: MeditationCache,
    private readonly keys: KeysService,
  ) {}

  /** The owner's stored settings, or the fresh-owner defaults before the first write. */
  async findOne(ownerSub: string): Promise<SettingsContent> {
    const row = await this.cache.getThrough(ownerSub, 'settings', () => this.loadRow(ownerSub), {
      cacheable: isCiphertextSettingsRow,
    });
    if (row === null) return DEFAULT_SETTINGS;
    return decodeSettingsContent(row, await this.keys.getDekForRead(ownerSub));
  }

  /** Replace the owner's settings; the cached row dies with the owner's generation. */
  async replace(ownerSub: string, dto: SettingsDto): Promise<SettingsContent> {
    const content = clampedSettings(dto);
    const dek = await this.keys.getOrCreateDek(ownerSub);
    const row = toCachedRow(ownerSub, content, dek);

    await this.settings.save(row);
    await this.cache.bumpGeneration(ownerSub);
    return content;
  }

  /** The row as stored, owner-scoped; lives inside the cache's loader and nowhere else. */
  private async loadRow(ownerSub: string): Promise<CachedSettingsRow | null> {
    const row = await this.settings.findOne({ where: { ownerSub } });
    return row === null ? null : { ownerSub: row.ownerSub, content: row.content };
  }
}

/**
 * The settings exactly as they will be stored: the goal on its fifteen-minute grid, the
 * planned length on its own five-minute one and defaulting to the goal.
 */
function clampedSettings(dto: SettingsDto): SettingsContent {
  const goalMinutes = clampGoal(dto.goalMinutes);
  return {
    goalMinutes,
    plannedMinutes: clampPlannedMinutes(dto.plannedMinutes ?? goalMinutes),
    bells: { ...dto.bells },
  };
}
