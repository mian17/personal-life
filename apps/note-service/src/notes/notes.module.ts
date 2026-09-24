import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Note } from './note.entity';
import { Tag } from './tag.entity';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';
import { TagsController } from './tags.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Note, Tag])],
  controllers: [NotesController, TagsController],
  providers: [NotesService],
})
export class NotesModule {}
