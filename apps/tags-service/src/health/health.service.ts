import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { loadMasterKeyFromEnv } from '@life/crypto';
import { runReadinessChecks, type HealthBody } from '@life/shared';
import { DataSource } from 'typeorm';
import { MASTER_KEY_ENV } from '../keys/keys.service';

export type { HealthBody };

/**
 * service-kernel health checks, shared by `/health/ready` and its deprecated
 * `/health` alias.
 *
 * The check order and failure semantics live in `@life/shared`
 * (`runReadinessChecks`), so every service runs one readiness contract; this
 * class only supplies this service's datasource, master-key env, and the `503`
 * body. Readiness checks exactly what genuinely breaks serving:
 * - the database is reachable (a cheap `SELECT 1`), and
 * - key custody is configured (the master key loads).
 *
 * It deliberately does NOT check the Contract 2 Redis cache: that is
 * fail-open, so its outage must never take the service out of rotation.
 * Liveness (`/health/live`) performs no dependency check at all.
 */
@Injectable()
export class HealthService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  liveness(): HealthBody {
    return { status: 'ok' };
  }

  readiness(): Promise<HealthBody> {
    // Key custody is a config presence check, not a read: the callback is sync.
    return runReadinessChecks({
      queryDatabase: () => this.dataSource.query('SELECT 1'),
      assertKeyCustody: () => loadMasterKeyFromEnv(MASTER_KEY_ENV),
      degraded: () => new ServiceUnavailableException({ status: 'degraded' }),
    });
  }
}
