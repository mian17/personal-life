import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { HealthModule } from './health/health.module';
import { KeysModule } from './keys/keys.module';
import { UserKeys } from './keys/user-keys.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: process.env.DB_PATH ?? join(process.cwd(), 'data', 'life.db'),
      entities: [UserKeys],
      synchronize: true,
    }),
    KeysModule,
    HealthModule,
  ],
})
export class AppModule {}
