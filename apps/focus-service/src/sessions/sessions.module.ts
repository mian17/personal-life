import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FOCUS_CACHE, createFocusCache } from '../cache/focus-cache';
import { Session } from './session.entity';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [TypeOrmModule.forFeature([Session])],
  controllers: [SessionsController],
  providers: [
    // Selection happens once at module init: no `REDIS_URL` keeps the direct-DB
    // path, a URL wires the service's single read-through adapter. The service is
    // unaware which. `KeysModule` is deliberately absent — session rows are
    // numbers and dates, so nothing here is sealed (`## Cache Rules` deviation).
    {
      provide: FOCUS_CACHE,
      useFactory: () => createFocusCache(process.env.REDIS_URL),
    },
    SessionsService,
  ],
})
export class SessionsModule {}
