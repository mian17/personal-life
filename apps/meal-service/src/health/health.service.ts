import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { loadMasterKeyFromEnv } from '@life/crypto';
import { DataSource } from 'typeorm';
import { MASTER_KEY_ENV } from '../keys/keys.service';

/** The health body vocabulary (SPEC-service-kernel, Health dialect). */
export interface HealthBody {
  status: 'ok' | 'degraded';
}

/**
 * The service-kernel health checks, shared by `/health/ready` and its deprecated
 * `/health` alias.
 *
 * Readiness checks exactly what genuinely breaks serving:
 * - the database is reachable (a cheap `SELECT 1`), and
 * - key custody is configured (the master key loads).
 *
 * It deliberately does NOT check the Contract 2 Redis cache: that cache is
 * fail-open, so a cache outage must never take the service out of rotation.
 * Liveness (`/health/live`) performs no dependency check at all.
 *
 * The probe is cheap and side-effect-free — no key generation, no writes.
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

  async readiness(): Promise<HealthBody> {
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
   * Key-custody presence check. Only the config is required here — DEKs are
   * provisioned lazily per owner on first content write, so no key material is
   * read, generated, or logged by a probe.
   */
  private assertKeyCustodyConfigured(): void {
    try {
      loadMasterKeyFromEnv(MASTER_KEY_ENV);
    } catch {
      throw new ServiceUnavailableException({ status: 'degraded' });
    }
  }
}