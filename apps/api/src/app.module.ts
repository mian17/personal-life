import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { Note } from './notes/note.entity';
import { Tag } from './notes/tag.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: process.env.DB_PATH ?? join(process.cwd(), 'data', 'life.db'),
      entities: [Note, Tag],
      synchronize: true,
    }),
  ],
})
export class AppModule {}
