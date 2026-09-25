import { Controller, Get } from '@nestjs/common';
import { Principal } from '../auth/principal';
import { NotesService } from './notes.service';

@Controller('api/tags')
export class TagsController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  list(@Principal() principal: Principal) {
    return this.notes.listTags(principal.sub);
  }
}
