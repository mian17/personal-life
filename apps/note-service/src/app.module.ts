import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { Note } from './notes/note.entity';
import { NoteTag } from './notes/note-tag.entity';
import { HealthModule } from './health/health.module';
import { KeysModule } from './keys/keys.module';
import { UserKeys } from './keys/user-keys.entity';
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
    KeysModule,
    HealthModule,
  ],
})
export class AppModule {}
