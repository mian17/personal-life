import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { resolveKeysPath } from '../crypto/signing-key.service';

/** The health body vocabulary (SPEC-service-kernel, Health dialect). */
export interface HealthBody {
  status: 'ok' | 'degraded';
}

/**
 * The uniform service-kernel health dialect (SPEC-service-kernel):
 * - `GET /health/live` → `200 {"status":"ok"}` — process liveness only.
 * - `GET /health/ready` → `200 {"status":"ok"}` | `503 {"status":"degraded"}` —
 *   DB reachable + key-custody **config presence**; never the fail-open cache.
 * - `GET /health` — the pre-existing body, now the deprecated alias of
 *   `/health/ready` (readiness semantics).
 *
 * The readiness probe is deliberately side-effect-free: it never calls
 * `SigningKeyService.jwks()` (which lazily generates and writes `keys.json`) and
 * so cannot create key material. Key material itself is created lazily on the
 * first OIDC request by design, so requiring a persisted file here would leave a
 * fresh instance permanently unready; presence of the key-custody configuration
 * is what is checked.
 */
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  @Get('live')
  live(): HealthBody {
    return { status: 'ok' };
  }

  @Get('ready')
  ready(): Promise<HealthBody> {
    return this.readiness();
  }

  @Get()
  alias(): Promise<HealthBody> {
    return this.readiness();
  }

  private async readiness(): Promise<HealthBody> {
    await this.assertDatabaseReachable();
    this.assertKeyCustodyConfigured();
    return { status: 'ok' };
  }

  /** Cheap round-trip through the datasource. Any failure means not ready. */
  private async assertDatabaseReachable(): Promise<void> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({ status: 'degraded' });
    }
  }

  /**
   * Key-custody config presence only: resolving the path is pure (env +
   * DB-path config), reads no file, and creates no key material. A misresolved
   * path fails closed to `degraded`; the path itself is never logged.
   */
  private assertKeyCustodyConfigured(): void {
    try {
      resolveKeysPath();
    } catch {
      throw new ServiceUnavailableException({ status: 'degraded' });
    }
  }
}
