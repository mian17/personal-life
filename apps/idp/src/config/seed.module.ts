import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { resolveDbPath } from './db-path';
import { User } from '../users/user.entity';
import { UsersModule } from '../users/users.module';

/**
 * Minimal module for host tooling (the seed script): just the database and
 * users — no OIDC provider, no login, no signing keys. This keeps production
 * seeding from demanding the OIDC client secret (which the full `AppModule`
 * asserts at boot) and keeps the seed out of the keystore path entirely.
 */
@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: resolveDbPath(),
      entities: [User],
      synchronize: true,
    }),
    UsersModule,
  ],
})
export class SeedModule {}
