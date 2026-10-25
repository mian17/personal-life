import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'node:path';
import { Tag } from './tags/tag.entity';
import { UserKeys } from './keys/user-keys.entity';
import { KeysModule } from './keys/keys.module';
import { TagsModule } from './tags/tags.module';
import { HealthModule } from '@life/service-kit';

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
    HealthModule.forRoot({ masterKeyEnv: 'TAGS_MASTER_KEY' }),
  ],
})
export class AppModule {}
