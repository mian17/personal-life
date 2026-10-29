import { Body, Controller, Get, Put } from '@nestjs/common';
import { Principal } from '@life/service-kit';
import { SetGoalDto } from './dto/set-goal.dto';
import { GoalsService } from './goals.service';

/**
 * Goal routes (`SPEC-focus-service` §1). `ownerSub` always comes from
 * `@Principal()`, never the request body.
 *
 * Only `PUT` and `GET`: a goal is set for a day and replaced by another set for
 * that same day, so no update-by-id or delete route exists.
 */
@Controller('api/goal')
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  /** Set the goal for the client's own day, replacing that day's row only. */
  @Put()
  set(@Principal() principal: Principal, @Body() dto: SetGoalDto) {
    return this.goals.setGoal(principal.sub, dto);
  }

  /** Every goal row the owner has, oldest first; the app resolves day → goal. */
  @Get()
  findAll(@Principal() principal: Principal) {
    return this.goals.findAll(principal.sub);
  }
}
