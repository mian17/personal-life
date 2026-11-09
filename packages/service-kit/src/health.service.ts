import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { loadMasterKeyFromEnv } from '@life/crypto';
import { runReadinessChecks, type HealthBody } from './readiness.js';
import { DataSource } from 'typeorm';

/** What a service must tell the kit: which env var holds its master key. */
export interface HealthOptions {
  /** e.g. `NOTE_MASTER_KEY`; readiness fails when it does not load. */
  masterKeyEnv: string;
}

/** Injection token carrying the service's {@link HealthOptions}. */
export const HEALTH_OPTIONS = Symbol('SERVICE_KIT_HEALTH_OPTIONS');

/**
 * The service-kernel health checks, shared by `/health/ready` and its
 * deprecated `/health` alias.
 *
 * The check order and failure semantics live in `@life/shared`
 * (`runReadinessChecks`), so every service runs one readiness contract; this
 * class supplies the datasource every service provides plus the master-key env
 * name the module was configured with.
 *
 * Readiness checks exactly what genuinely breaks serving:
 * - the database is reachable (a cheap `SELECT 1`), and
 * - key custody is configured (the master key loads).
 *
 * It deliberately does NOT check the Contract 2 Redis cache or RabbitMQ: both
 * are fail-open on the HTTP path, so an outage of either must never take the
 * service out of rotation. Liveness (`/health/live`) checks no dependency at all.
 */
@Injectable()
export class HealthService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @Inject(HEALTH_OPTIONS)
    private readonly options: HealthOptions,
  ) {}

  liveness(): HealthBody {
    return { status: 'ok' };
  }

  readiness(): Promise<HealthBody> {
    return runReadinessChecks({
      queryDatabase: () => this.dataSource.query('SELECT 1'),
      assertKeyCustody: () => loadMasterKeyFromEnv(this.options.masterKeyEnv),
      degraded: () => new ServiceUnavailableException({ status: 'degraded' }),
    });
  }
}
