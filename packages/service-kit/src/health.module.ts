import { Module, type DynamicModule } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HEALTH_OPTIONS, HealthService, type HealthOptions } from './health.service';

export { HEALTH_OPTIONS };
export type { HealthOptions };

/**
 * The service-kernel health trio, wired from one implementation.
 *
 * A service imports `HealthModule.forRoot({ masterKeyEnv: 'NOTE_MASTER_KEY' })`
 * and gets `/health/live`, `/health/ready`, and the `/health` alias, all
 * unauthenticated and leak-free. The datasource comes from the global
 * `TypeOrmModule` the app already registers; no cache or broker dependency
 * exists, so readiness stays fail-open-safe by construction.
 */
@Module({})
export class HealthModule {
  static forRoot(options: HealthOptions): DynamicModule {
    return {
      module: HealthModule,
      controllers: [HealthController],
      providers: [HealthService, { provide: HEALTH_OPTIONS, useValue: options }],
    };
  }
}
