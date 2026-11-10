import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KeysModule } from '@life/service-kit';
import { MASTER_KEY_ENV } from '../service-config.js';
import { Note } from './note.entity.js';
import { NoteTag } from './note-tag.entity.js';
import { NotesController } from './notes.controller.js';
import { NotesBatchController } from './notes-batch.controller.js';
import { NOTES_CACHE, createNotesCache } from './notes-cache.js';
import { NotesService } from './notes.service.js';
import { TagsController } from './tags.controller.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Note, NoteTag]),
    KeysModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
  ],
  // The batch controller is listed first on purpose: its routes are literal
  // (`/api/notes:batchCreate`), and registration order is what keeps a
  // parameter route from claiming a path that only looks parameterised.
  controllers: [NotesBatchController, NotesController, TagsController],
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
