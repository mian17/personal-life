import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { Tag } from './tags/tag.entity';
import { UserKeys } from './keys/user-keys.entity';
import { KeysModule } from './keys/keys.module';
import { TagsModule } from './tags/tags.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: process.env.DB_PATH ?? join(process.cwd(), 'data', 'tags.db'),
      entities: [Tag, UserKeys],
      synchronize: true,
    }),
    TagsModule,
    KeysModule,
    HealthModule,
  ],
})
export class AppModule {}
