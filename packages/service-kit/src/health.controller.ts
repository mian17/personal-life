import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service.js';
import type { HealthBody } from './readiness.js';
import { Public } from './public.decorator.js';

export type { HealthBody };

/**
 * The uniform service-kernel health dialect (`SPEC-service-kernel`):
 * - `GET /health/live` → `200 {"status":"ok"}` — process liveness only.
 * - `GET /health/ready` → `200 {"status":"ok"}` | `503 {"status":"degraded"}` —
 *   DB + key custody, never the fail-open cache.
 * - `GET /health` — deprecated alias of `/health/ready` (readiness semantics);
 *   the Playwright harness polls it and treats `<500` as ready.
 *
 * All three are `@Public()` (probes cannot log in) and leak-free: the body is
 * exactly the status JSON — no versions, config, or error details.
 *
 * The class lives here rather than in each service so the three routes and their
 * unauthenticated/leak-free guarantees have exactly one implementation; a new
 * service gets the dialect by importing the module.
 */
@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  live(): HealthBody {
    return this.health.liveness();
  }

  @Get('ready')
  ready(): Promise<HealthBody> {
    return this.health.readiness();
  }

  @Get()
  alias(): Promise<HealthBody> {
    return this.health.readiness();
  }
}
