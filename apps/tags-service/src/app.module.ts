import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'node:path';
import { Tag } from './tags/tag.entity.js';
import { TagsModule } from './tags/tags.module.js';
import { HealthModule, KeysModule, UserKeys } from '@life/service-kit';
import { MASTER_KEY_ENV } from './service-config.js';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: process.env.DB_PATH ?? join(process.cwd(), 'data', 'tags.db'),
      entities: [Tag, UserKeys],
      synchronize: true,
    }),
    TagsModule,
    KeysModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
    HealthModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
  ],
})
export class AppModule {}
