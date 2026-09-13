import { Controller, Get } from '@nestjs/common';
import { NotesService } from './notes.service';

@Controller('api/tags')
export class TagsController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  list() {
    return this.notes.listTags();
  }
}
