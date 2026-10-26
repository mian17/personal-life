import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { Principal } from '@life/service-kit';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { TargetService } from './target.service';

/**
 * Target routes (`SPEC-target-onboarding`). `ownerSub` always comes from
 * `@Principal()`, never the request body (`SPEC-meal-service` Code Style).
 */
@Controller('api/target')
export class TargetController {
  constructor(private readonly targets: TargetService) {}

  /** The row applicable to `date` (`YYYY-MM-DD`, required). Read straight from the DB. */
  @Get()
  get(@Principal() principal: Principal, @Query('date') date?: string) {
    return this.targets.getTarget(principal.sub, date);
  }

  /** Insert a new versioned target row for a profile change (client's `date` = `validFrom`). */
  @Put('profile')
  putProfile(@Principal() principal: Principal, @Body() dto: UpdateProfileDto) {
    return this.targets.updateProfile(principal.sub, dto);
  }
}
