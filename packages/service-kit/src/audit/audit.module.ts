/**
 * Wiring for the audit capability, imported once per service (SPEC-audit-log
 * §4, §9.9).
 *
 * A service writes `AuditModule.forRoot()` in its `imports` and registers
 * `AuditEntry` in its own `TypeOrmModule.forRoot` entities. That single import
 * registers the `audit_log` repository, creates the in-process emitter, subscribes
 * the writing listener to it, and installs the capture middleware globally.
 *
 * No broker, no cache, no new dependency: the bus is `node:events`, and the
 * listener never touches the read-through cache, because these rows are
 * append-only telemetry with no read leg (`## Cache Rules` deviation).
 *
 * The no-op path (§8.6) is a service that never imports this module: its
 * middleware resolves no emitter and emission does nothing.
 */
import {
  Module,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitter } from 'node:events';
import type { DataSource } from 'typeorm';
import { AuditEntry } from './audit-entry.entity.js';
import { AUDIT_EMITTER } from './audit-event.js';
import { createAuditListener, type AuditRowWriter } from './audit-listener.js';
import { AUDIT_EVENT_NAME, AuditMiddleware } from './audit.middleware.js';

/** Every request, including paths no controller matches, reaches the middleware. */
const EVERY_REQUEST = '{*path}';

@Module({})
export class AuditModule implements NestModule {
  static forRoot(): DynamicModule {
    return {
      module: AuditModule,
      imports: [TypeOrmModule.forFeature([AuditEntry])],
      providers: [
        {
          provide: AUDIT_EMITTER,
          useFactory: createAuditEmitter,
          inject: [getDataSourceToken()],
        },
        AuditMiddleware,
      ],
      exports: [AUDIT_EMITTER],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuditMiddleware).forRoutes(EVERY_REQUEST);
  }
}

/** The bus plus its one subscriber: the writing listener, on this service's own DB. */
function createAuditEmitter(dataSource: DataSource): EventEmitter {
  const emitter = new EventEmitter();
  emitter.on(AUDIT_EVENT_NAME, createAuditListener(auditRowWriter(dataSource)));
  return emitter;
}

/** The listener's write seam over the `audit_log` repository. */
function auditRowWriter(dataSource: DataSource): AuditRowWriter {
  const rows = dataSource.getRepository(AuditEntry);
  return { save: (row) => rows.save(row) };
}
