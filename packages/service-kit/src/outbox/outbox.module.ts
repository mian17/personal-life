import { Module, type DynamicModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createHttpDelivery, OUTBOX_DELIVERY, type OutboxDelivery } from './outbox-delivery.js';
import { OutboxPollerService } from './outbox-poller.service.js';
import { Outbox } from './outbox.entity.js';
import { OutboxService } from './outbox.service.js';

/** What a producer service may decide about its outbox. Everything else is fixed. */
export interface OutboxOptions {
  /**
   * The sender the poller calls. A test passes a fake; a service passes whatever
   * credential path it actually has. Absent means `createHttpDelivery()`, which
   * refuses with the documented message instead of sending an unauthenticated
   * request, so an app that says nothing keeps today's inert behaviour.
   */
  delivery?: OutboxDelivery;
}

/**
 * The transactional outbox, wired from one implementation, mirroring
 * `KeysModule.forRoot` and `GrantsModule.forRoot`.
 *
 * A producer service imports `OutboxModule.forRoot({ delivery })`, injects
 * `OutboxService` to enqueue inside its own transaction, and — if it delivers
 * itself — lets `OutboxPollerService` drain. The module opens no connection of
 * its own: `TypeOrmModule.forFeature` registers `Outbox` against the DataSource
 * the importing hub already established, so the one `outbox` table lands in that
 * hub's own database.
 *
 * The producer is deliberately **not** provided here: deciding what a service
 * owes another is that service's business, and a producer in the kit would be
 * the fork this extraction exists to prevent.
 */
@Module({})
export class OutboxModule {
  static forRoot(options: OutboxOptions = {}): DynamicModule {
    return {
      module: OutboxModule,
      imports: [TypeOrmModule.forFeature([Outbox])],
      providers: [
        OutboxService,
        { provide: OUTBOX_DELIVERY, useFactory: () => options.delivery ?? createHttpDelivery() },
        OutboxPollerService,
      ],
      exports: [OutboxService, OutboxPollerService],
    };
  }
}
