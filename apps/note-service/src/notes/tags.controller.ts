import { Controller, Get } from '@nestjs/common';
import { Principal } from '../auth/principal';
import { NotesService } from './notes.service';

/**
 * The owner's tag usage surface. Shape changed in place by the tags extraction:
 * `[{tagId, count}]` — registry ids + usage counts only (no names; the app
 * resolves names through `tags-service`, MAP M4 / `SPEC-tags-extraction`).
 */
@Controller('api/tags')
export class TagsController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  list(@Principal() principal: Principal) {
    return this.notes.listTagUsage(principal.sub);
  }
}
