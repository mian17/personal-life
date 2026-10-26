import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'node:path';
import { Note } from './notes/note.entity';
import { NoteTag } from './notes/note-tag.entity';
import { HealthModule, KeysModule, UserKeys } from '@life/service-kit';
import { MASTER_KEY_ENV } from './service-config';
import { NotesModule } from './notes/notes.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: process.env.DB_PATH ?? join(process.cwd(), 'data', 'life.db'),
      entities: [Note, NoteTag, UserKeys],
      synchronize: true,
    }),
    NotesModule,
    KeysModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
    HealthModule.forRoot({ masterKeyEnv: MASTER_KEY_ENV }),
  ],
})
export class AppModule {}
