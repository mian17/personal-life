import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Adapter, AdapterPayload } from 'oidc-provider';
import { LessThanOrEqual, Repository } from 'typeorm';
import { OidcPayload } from './oidc-payload.entity';

/** Unix seconds, the unit the provider uses for `expiresIn`. */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function keyFor(model: string, id: string): string {
  return `${model}:${id}`;
}

/**
 * One Adapter per oidc-provider model, over the shared `oidc_payload` table.
 * Payloads are stored verbatim as JSON; `consumed` is the provider's own flag
 * (it sets `payload.consumed`), so we persist whatever we are handed.
 *
 * Expired rows are ignored on read here. A periodic sweep is deliberately left
 * out (see report note): the provider stops handing out expired artifacts, and
 * a GC job can be added later without changing this interface.
 */
class SqliteAdapter implements Adapter {
  constructor(
    private readonly model: string,
    private readonly repo: Repository<OidcPayload>,
  ) {}

  private decode(row: OidcPayload | undefined | null): AdapterPayload | undefined {
    if (!row) return undefined;
    if (row.expiresAt !== null && row.expiresAt <= nowSeconds()) return undefined;
    return JSON.parse(row.payload) as AdapterPayload;
  }

  async upsert(id: string, payload: AdapterPayload, expiresIn?: number): Promise<void> {
    const key = keyFor(this.model, id);
    const existing = await this.repo.findOne({ where: { key } });
    const grantId = typeof payload.grantId === 'string' ? payload.grantId : null;
    const uid = typeof payload.uid === 'string' ? payload.uid : null;
    const userCode = typeof payload.userCode === 'string' ? payload.userCode : null;
    const expiresAt = typeof expiresIn === 'number' ? nowSeconds() + expiresIn : null;

    const row: OidcPayload = {
      key,
      model: this.model,
      id,
      payload: JSON.stringify(payload),
      grantId,
      uid,
      userCode,
      expiresAt,
    };

    if (existing) {
      await this.repo.update({ key }, row);
    } else {
      await this.repo.insert(row);
    }
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    return this.decode(await this.repo.findOne({ where: { key: keyFor(this.model, id) } }));
  }

  async findByUid(uid: string): Promise<AdapterPayload | undefined> {
    return this.decode(
      await this.repo.findOne({ where: { model: this.model, uid } }),
    );
  }

  async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
    return this.decode(
      await this.repo.findOne({ where: { model: this.model, userCode } }),
    );
  }

  async consume(id: string): Promise<void> {
    const key = keyFor(this.model, id);
    const row = await this.repo.findOne({ where: { key } });
    if (!row) return;
    const payload = JSON.parse(row.payload) as AdapterPayload;
    payload.consumed = nowSeconds();
    await this.repo.update({ key }, { payload: JSON.stringify(payload) });
  }

  async destroy(id: string): Promise<void> {
    await this.repo.delete({ key: keyFor(this.model, id) });
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    await this.repo.delete({ grantId });
  }

  /** Removes expired rows for this model; available for a future GC job. */
  async purgeExpired(): Promise<number> {
    const result = await this.repo.delete({ expiresAt: LessThanOrEqual(nowSeconds()) });
    return result.affected ?? 0;
  }
}

/**
 * AdapterFactory: the provider calls this once per model and caches the result,
 * so every model gets its own adapter instance bound to the same repository.
 */
@Injectable()
export class OidcAdapterService {
  constructor(
    @InjectRepository(OidcPayload) private readonly repo: Repository<OidcPayload>,
  ) {}

  factory(): (name: string) => Adapter {
    return (name: string) => new SqliteAdapter(name, this.repo);
  }

  /** Test/debug aid: how many rows exist for a model. */
  count(model?: string): Promise<number> {
    return this.repo.count(model ? { where: { model } } : undefined);
  }
}
