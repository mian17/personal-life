import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { Principal } from '@life/service-kit';
import { PushSubscribeDto, PushUnsubscribeDto } from './push-subscribe.dto';
import { PushService } from './push.service';

/**
 * The push HTTP surface (`SPEC-todo-service`). The global `AuthGuard` guards
 * every route; handlers read the owner via `@Principal()`. Static paths only —
 * there is no `:id` route, so ordering never shadows anything.
 */
@Controller('api/push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('key')
  getKey(): { publicKey: string } {
    return this.push.getPublicKey();
  }

  @Post('subscribe')
  async subscribe(@Principal() principal: Principal, @Body() dto: PushSubscribeDto) {
    await this.push.subscribe(principal.sub, dto);
    return { ok: true };
  }

  @Delete('subscribe')
  async unsubscribe(@Principal() principal: Principal, @Body() dto: PushUnsubscribeDto) {
    await this.push.unsubscribe(principal.sub, dto.endpoint);
    return { ok: true };
  }
}
