import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PushSubscription } from './push-subscription.entity.js';
import { PushController } from './push.controller.js';
import { PushService } from './push.service.js';

/**
 * The push module. `PushService` is exported so the reminders sweep can list a
 * user's subscriptions within the process. `push_subscription` is not cached.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PushSubscription])],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
