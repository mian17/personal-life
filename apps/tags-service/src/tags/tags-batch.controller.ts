import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Principal } from '@life/service-kit';
import { BatchCreateTagsDto, BatchUpdateTagsDto } from './dto/batch-tags.dto';
import { TagsService } from './tags.service';

/**
 * The `tags` batch pair (`SPEC-tags-service.md` §5). There is no
 * `:batchDelete`: the confirmed intent excludes it.
 *
 * Prefix-less controller with full, colon-escaped method paths. Nest joins the
 * controller and method paths with a slash, so `@Post(':batchCreate')` on a
 * prefixed controller could only ever register the parameter route
 * `/api/tags/:batchCreate` — never the literal AIP URI. Registered before
 * `TagsController`, so a literal route wins over the singular `:id` routes.
 */
@Controller()
export class TagsBatchController {
  constructor(private readonly tags: TagsService) {}

  @Post('api/tags\\:batchCreate')
  @HttpCode(201)
  createMany(@Principal() principal: Principal, @Body() dto: BatchCreateTagsDto) {
    return this.tags.createMany(principal.sub, dto.items);
  }

  @Post('api/tags\\:batchUpdate')
  @HttpCode(200)
  updateMany(@Principal() principal: Principal, @Body() dto: BatchUpdateTagsDto) {
    return this.tags.renameMany(principal.sub, dto.items);
  }
}
