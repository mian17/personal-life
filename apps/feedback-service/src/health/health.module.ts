import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * The service-kernel health trio. The datasource is injected from the global
 * `TypeOrmModule`; no cache or broker dependency — readiness is fail-open-safe
 * by construction.
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
