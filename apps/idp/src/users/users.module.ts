import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UsersService } from './users.service';
import { USERS_CACHE, createUsersCache } from './users-cache';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [
    UsersService,
    // One decision at module init: `REDIS_URL` set → cached wrapper, unset →
    // today's direct DB path. Re-evaluating per request would add a branch to
    // every login; the seam is chosen once and stays put.
    {
      provide: USERS_CACHE,
      useFactory: () => createUsersCache(process.env.REDIS_URL),
    },
  ],
  exports: [UsersService],
})
export class UsersModule {}
