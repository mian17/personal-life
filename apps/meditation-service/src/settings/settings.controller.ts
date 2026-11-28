import { Body, Controller, Get, Put } from '@nestjs/common';
import { Principal } from '@life/service-kit';
import { SettingsDto } from './settings.dto.js';
import { SettingsService } from './settings.service.js';

/**
 * Settings routes (`SPEC-meditation-app` §1). `ownerSub` always comes from
 * `@Principal()`, never the request body.
 *
 * Only `PUT` and `GET`: one settings row per owner, replaced whole by each write, so
 * no update-by-id and no delete route exists.
 */
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** Replace the owner's whole configuration; the goal clamps, the bells must be valid. */
  @Put()
  replace(@Principal() principal: Principal, @Body() dto: SettingsDto) {
    return this.settings.replace(principal.sub, dto);
  }

  /** The owner's settings, or the fresh-owner defaults before the first write. */
  @Get()
  findOne(@Principal() principal: Principal) {
    return this.settings.findOne(principal.sub);
  }
}
