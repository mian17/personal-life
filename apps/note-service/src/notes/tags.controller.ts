import { Controller, Get, Query } from '@nestjs/common';
import { Principal } from '@life/service-kit';
import { ListTagUsageQuery } from './dto/list-tag-usage.query';
import { NotesService } from './notes.service';

/**
 * The owner's tag usage surface. Shape changed in place by the tags extraction:
 * `[{tagId, count}]` — registry ids + usage counts only (no names; the app
 * resolves names through `tags-service`, MAP M4 / `SPEC-tags-extraction`).
 *
 * `GET /api/tags` answers one page (`TagUsagePage`) rather than a bare array, on
 * the shared cursor seam. The set is bounded by the owner's tag vocabulary, so
 * the envelope is contract uniformity, not a performance gain.
 */
@Controller('api/tags')
export class TagsController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  list(@Principal() principal: Principal, @Query() query: ListTagUsageQuery) {
    return this.notes.tagUsagePage(principal.sub, query);
  }
}
