import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { CryptoError, ENC_PREFIX, decryptField, encryptField } from '@life/crypto';
import type { CreateFeedbackInput, FeedbackDto, FeedbackPage, FeedbackStatus } from '@life/shared';
import { Feedback } from './feedback.entity';
import { FeedbackEvent } from './feedback-event.entity';
import { FEEDBACK_CACHE, FeedbackCache } from './feedback-cache';
import { DEFAULT_PAGE_LIMIT, KeysService, paginate } from '@life/service-kit';

/**
 * AAD for a feedback title (`SPEC-feedback-service` Data model). Byte-exact:
 * the identical string must be reconstructed at encrypt and decrypt, and the
 * id it binds is client-supplied, so it is known up front.
 */
function titleAad(ownerSub: string, feedbackId: string): string {
  return `life.v1|${ownerSub}|feedback|title|${feedbackId}`;
}

function descriptionAad(ownerSub: string, feedbackId: string): string {
  return `life.v1|${ownerSub}|feedback|description|${feedbackId}`;
}

/**
 * The cached shape: a `feedback` row **as persisted** — `title` and
 * `description` are `enc.v1.` envelopes, never plaintext (Contract 2 Rule 2),
 * while `status` is plaintext workflow metadata cached beside `app`/`type`
 * (`SPEC-feedback-status` Cache Rules).
 */
interface CachedFeedbackRow {
  id: string;
  app: string;
  type: string;
  status: FeedbackStatus;
  title: string;
  description: string;
  createdAt: string;
}

/** Serialize a feedback entity into its ciphertext-row form (date → ISO). */
function toCachedRow(feedback: Feedback): CachedFeedbackRow {
  return {
    id: feedback.id,
    app: feedback.app,
    type: feedback.type,
    status: feedback.status,
    title: feedback.title,
    description: feedback.description,
    createdAt: feedback.createdAt.toISOString(),
  };
}

/**
 * True when the serialized row's content fields are `enc.v1.` envelopes, so
 * the populate may touch Redis. A non-envelope row must never be cached (Redis
 * is AOF-persistent), so it refuses (`cacheable`) and is served straight from
 * the DB instead.
 */
function isCiphertextRow(row: CachedFeedbackRow): boolean {
  return (
    typeof row?.title === 'string' &&
    row.title.startsWith(ENC_PREFIX) &&
    typeof row?.description === 'string' &&
    row.description.startsWith(ENC_PREFIX)
  );
}

/** Reject a hit whose serialized rows are not all `enc.v1.` ciphertext. */
function decodeCiphertextList(raw: unknown): CachedFeedbackRow[] {
  if (!Array.isArray(raw) || !raw.every(isCiphertextRow)) {
    throw new Error('cache entry is not ciphertext');
  }
  return raw;
}

/** Newest-first (`createdAt DESC, id DESC`), applied after every cache hit. */
function newestFirst(a: FeedbackDto, b: FeedbackDto): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

/**
 * `newestFirst`'s strictly-after test, in the same descending order: a row comes
 * after the cursor when its `createdAt` sorts earlier, or when the timestamps tie
 * and its `id` sorts earlier. Comparing the hydrated ISO strings (not the stored
 * rows) is what lets a page boundary sit on a timestamp tie without repeating or
 * skipping the row the cursor names.
 */
function afterNewestFirst(row: FeedbackDto, at: string[]): boolean {
  const [createdAt, id] = at;
  return row.createdAt < createdAt || (row.createdAt === createdAt && row.id < id);
}

/**
 * True for a Postgres unique violation (SQLSTATE 23505) on this write's
 * idempotency columns (`feedback.id`, `feedback_event.event_id`). Any other
 * driver error propagates — a failed write must never look like a won race.
 */
function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof QueryFailedError &&
    (err.driverError as { code?: string } | undefined)?.code === '23505'
  );
}

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    @InjectRepository(Feedback) private readonly feedback: Repository<Feedback>,
    @Inject(FEEDBACK_CACHE) private readonly cache: FeedbackCache,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly keys: KeysService,
  ) {}

  /**
   * `POST /api/feedback` (`SPEC-feedback-service` Data model: Idempotency).
   *
   * - `feedback` + `feedback_event` (`event_id = feedback.id`, `occurred_at =
   *   now()`) are inserted in **one transaction**; the owner's generation is
   *   bumped only *after* it commits, so a thrown transaction never bumps.
   * - An `id` the caller already owns is a no-op returning the same `201 { id }`
   *   — one row, one event, however often it is retried. Never `409`.
   * - An `id` owned by another `sub` — and a unique violation on one, whether it
   *   is this sub's retry or another owner's row — is `404`, byte-identical to
   *   missing. Never `403`/`409`: those leak existence.
   */
  async create(sub: string, input: CreateFeedbackInput): Promise<{ id: string }> {
    // "required, non-empty after trim" (`SPEC-feedback-service` API contract):
    // a whitespace-only title or body never reaches the store, and `400` is the
    // only validation status the service answers.
    const title = input.title.trim();
    if (!title) throw new BadRequestException('title must not be empty');
    const description = input.description.trim();
    if (!description) throw new BadRequestException('description must not be empty');

    const existing = await this.feedback.findOne({ where: { id: input.id } });
    if (existing) {
      if (existing.ownerSub !== sub) throw new NotFoundException('Feedback not found');
      return { id: existing.id };
    }

    const dek = await this.keys.getOrCreateDek(sub);
    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.insert(Feedback, {
          id: input.id,
          ownerSub: sub,
          app: input.app,
          type: input.type,
          title: encryptField(dek, title, titleAad(sub, input.id)),
          description: encryptField(dek, description, descriptionAad(sub, input.id)),
        });
        await manager.insert(FeedbackEvent, {
          eventId: input.id,
          feedbackId: input.id,
          ownerSub: sub,
          app: input.app,
          type: input.type,
        });
      });
    } catch (err) {
      // Swallowed only as a won race on the idempotency key: the row now
      // exists, so the owner filter decides no-op vs 404.
      if (!isUniqueViolation(err)) throw err;
      const own = await this.feedback.findOne({ where: { id: input.id, ownerSub: sub } });
      if (!own) throw new NotFoundException('Feedback not found');
      return { id: own.id };
    }

    // Bump AFTER the commit — see the note on `bumpGeneration`.
    await this.cache.bumpGeneration(sub);
    return { id: input.id };
  }

  /**
   * `GET /api/feedback` — one cursor page of the owner's rows newest-first, read
   * through the read-through cache. Key `feedback:<sub>:v<gen>:list` holds the
   * whole ciphertext row set (`SPEC-feedback-service` Cache Rules): filters and
   * pagination never enter the key, so one entry serves every page of every read.
   * Decrypt, DTO assembly, and the `createdAt DESC, id DESC` ordering all run
   * **after** the hit, so plaintext never exists outside the request path; paging
   * is then a post-hit projection through the shared seam
   * (`SPEC-pagination-seam` §6), which is why an in-memory slice is enough.
   */
  async findAll(sub: string, opts: { limit?: number; cursor?: string }): Promise<FeedbackPage> {
    const limit = opts.limit ?? DEFAULT_PAGE_LIMIT;
    const rows = await this.cache.getThrough(
      sub,
      'list',
      async () => {
        const found = await this.feedback.find({
          where: { ownerSub: sub },
          order: { createdAt: 'DESC', id: 'DESC' },
        });
        return found.map(toCachedRow);
      },
      { decode: decodeCiphertextList, cacheable: (value) => value.every(isCiphertextRow) },
    );
    if (rows.length === 0) return { feedback: [], nextCursor: null };
    const dek = await this.keys.getDekForRead(sub);
    const ordered = rows.map((row) => this.toDto(row, sub, dek)).sort(newestFirst);
    const page = paginate(ordered, {
      limit,
      cursor: opts.cursor,
      keyOf: (row) => [row.createdAt, row.id],
      after: afterNewestFirst,
    });
    return { feedback: page.rows, nextCursor: page.nextCursor };
  }

  /**
   * `PATCH /api/feedback/:id` (`SPEC-feedback-status` Service API).
   *
   * Owner-scoped: the row must belong to `sub`, so a foreign id reads exactly
   * like a missing one — the same `404`, byte-identical, never `403` (the
   * `POST` rule: existence must not leak). Setting the current status again is
   * a no-op write returning the same `200 { id, status }`, never `409`. A
   * status change writes the `feedback` row and bumps the owner's generation
   * after the write commits; it writes no `feedback_event` row and emits no
   * event, so the published `feedback.submitted` contract is untouched.
   */
  async updateStatus(
    sub: string,
    id: string,
    status: FeedbackStatus,
  ): Promise<{ id: string; status: FeedbackStatus }> {
    const owned = { id, ownerSub: sub };
    const written = await this.feedback.update(owned, { status });
    if (!written.affected) throw new NotFoundException('Feedback not found');
    // Bump AFTER the committed write: a thrown write must never invalidate.
    await this.cache.bumpGeneration(sub);
    return { id, status };
  }

  /**
   * Assemble one wire DTO from a stored row. Decrypts in the request path only
   * and fails closed: an unprefixed value is corruption (every feedback row is
   * encrypted from day one, so there is no dual-read), a missing key or a
   * tampered envelope throws — never ciphertext, never garbage.
   */
  private toDto(row: CachedFeedbackRow, sub: string, dek: Buffer): FeedbackDto {
    let title: string;
    if (!row.title.startsWith(ENC_PREFIX)) {
      this.logger.error(`decrypt failed for feedback ${row.id}`);
      throw new CryptoError('stored feedback title is not an enc.v1 envelope');
    }
    let description: string;
    if (!row.description.startsWith(ENC_PREFIX)) {
      this.logger.error(`decrypt failed for feedback ${row.id}`);
      throw new CryptoError('stored feedback description is not an enc.v1 envelope');
    }
    try {
      title = decryptField(dek, row.title, titleAad(sub, row.id));
      description = decryptField(dek, row.description, descriptionAad(sub, row.id));
    } catch (err) {
      // Ids only — never content, keys, or AAD.
      this.logger.error(`decrypt failed for feedback ${row.id}`);
      throw err;
    }
    return { id: row.id, app: row.app, type: row.type, status: row.status, title, description, createdAt: row.createdAt };
  }
}