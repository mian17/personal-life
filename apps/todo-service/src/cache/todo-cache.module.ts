import { Module } from '@nestjs/common';
import { TODO_CACHE, createTodosCache } from './todo-cache.js';

/**
 * The single cache instance shared by the todo and list services (one
 * generation counter `todo:gen:<sub>` per owner). Nest instantiates this module
 * once and both importers receive the same `TODO_CACHE` provider, so a write in
 * either service invalidates every shape together.
 */
@Module({
  providers: [
    // Selection happens once at module init: REDIS_URL unset keeps the
    // direct-DB path; set wires the read-through cache. Services are unaware.
    {
      provide: TODO_CACHE,
      useFactory: () => createTodosCache(process.env.REDIS_URL),
    },
  ],
  exports: [TODO_CACHE],
})
export class TodoCacheModule {}
