import { Body, Controller, Get, Put } from '@nestjs/common';
import { Principal } from '@life/service-kit';
import { SetGoalDto } from './goal-history.dto.js';
import { GoalHistoryService } from './goal-history.service.js';

/**
 * Daily-goal history routes (`SPEC-meditation-app` §1). `ownerSub` always comes from
 * `@Principal()`, never the request body.
 *
 * Only `PUT` and `GET`: one row per day the owner set a goal on, replaced by that day's write, so
 * no update-by-id and no delete route exists — the past is not editable from here.
 */
@Controller('settings/goals')
export class GoalHistoryController {
  constructor(private readonly goals: GoalHistoryService) {}

  /** Set one day's goal; a missing or impossible day is a 400, never a default. */
  @Put()
  setGoal(@Principal() principal: Principal, @Body() dto: SetGoalDto) {
    return this.goals.setGoal(principal.sub, dto.date, dto.minutes);
  }

  /** The owner's whole goal history, oldest first. */
  @Get()
  findAll(@Principal() principal: Principal) {
    return this.goals.findAll(principal.sub);
  }
}
