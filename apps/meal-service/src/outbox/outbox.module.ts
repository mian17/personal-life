import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createHttpDelivery, OUTBOX_DELIVERY } from './outbox-delivery.js';
import { OutboxPollerService } from './outbox-poller.service.js';
import { Outbox } from './outbox.entity.js';
import { OutboxService } from './outbox.service.js';

/**
 * The outbox wiring (`SPEC-meal-service`): the writer (`OutboxService`) and the
 * relay (`OutboxPollerService`) over one table in this service's own database.
 * The delivery token is composed from the environment here — a test overrides
 * it with a fake, so no suite ever reaches the network.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Outbox])],
  providers: [
    OutboxService,
    { provide: OUTBOX_DELIVERY, useFactory: () => createHttpDelivery() },
    OutboxPollerService,
  ],
  exports: [OutboxService, OutboxPollerService],
})
export class OutboxModule {}
