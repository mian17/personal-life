import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: process.env.DB_PATH ?? join(process.cwd(), 'data', 'idp.db'),
      entities: [],
      synchronize: true,
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
