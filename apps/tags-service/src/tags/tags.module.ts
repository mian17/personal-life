import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KeysModule } from '@life/service-kit';
import { MASTER_KEY_ENV } from '../service-config';
import { Tag } from './tag.entity';
import { TagsController } from './tags.controller';
import { TagsBatchController } from './tags-batch.controller';
import { TAGS_CACHE, createTagsCache } from './tags-cache';
import { TagsService } from './tags.service';

@Module({
  imports: [TypeOrmModule.forFeature([Tag]), KeysModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV })],
  // The batch controller is listed first on purpose: its routes are literal
  // (`/api/tags:batchCreate`), and registration order is what keeps the `:id`
  // parameter routes from claiming a path that only looks parameterised.
  controllers: [TagsBatchController, TagsController],
  providers: [
    // Selection happens once at module init: REDIS_URL unset keeps today's
    // direct-DB path; set wires the read-through cache. Controllers are unaware.
    {
      provide: TAGS_CACHE,
      useFactory: () => createTagsCache(process.env.REDIS_URL),
    },
    TagsService,
  ],
})
export class TagsModule {}
