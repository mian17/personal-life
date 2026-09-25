import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Note } from './note.entity';
import { Tag } from './tag.entity';
import { NotesController } from './notes.controller';
import { NOTES_CACHE, createNotesCache } from './notes-cache';
import { NotesService } from './notes.service';
import { TagsController } from './tags.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Note, Tag])],
  controllers: [NotesController, TagsController],
  providers: [
    // Selection happens once at module init: REDIS_URL unset keeps today's
    // direct-DB path; set wires the read-through cache. Controllers are unaware.
    {
      provide: NOTES_CACHE,
      useFactory: () => createNotesCache(process.env.REDIS_URL),
    },
    NotesService,
  ],
})
export class NotesModule {}
