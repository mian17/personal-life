import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { HealthService, type HealthBody } from './health.service';

/**
 * The uniform service-kernel health dialect (`SPEC-service-kernel` /
 * `SPEC-meal-service`):
 * - `GET /health/live` → `200 {"status":"ok"}` — process liveness only.
 * - `GET /health/ready` → `200 {"status":"ok"}` | `503 {"status":"degraded"}` —
 *   DB + key custody, never the fail-open cache.
 * - `GET /health` — deprecated alias of `/health/ready` (readiness semantics);
 *   harnesses poll it and treat `<500` as ready.
 *
 * All three are `@Public()` (probes cannot log in) and leak-free: the body is
 * exactly the status JSON — no versions, config, or error details.
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