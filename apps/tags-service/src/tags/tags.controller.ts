import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Principal } from '@life/service-kit';
import { TagsService, type TagDto, type TagPage } from './tags.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { ListTagsQuery } from './dto/list-tags.query';
import { UpdateTagDto } from './dto/update-tag.dto';
import { ResolveTagsDto } from './dto/resolve-tags.dto';

/**
 * The ecosystem tag registry HTTP surface (`SPEC-tags-service` API).
 *
 * Route declaration order matters: the literal `resolve` route is declared
 * **before** any `:id` route so Nest does not shadow it.
 */
@Controller('api/tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  /**
   * `200 TagPage` — `{ tags, nextCursor }` in `byName` order — or `400` for a
   * `limit`/`cursor` the query DTO rejects. The vocabulary is small by nature, so
   * the window is the shared list contract, not a bounded scan; an omitted `limit`
   * gets the seam's default (50) and the cap (200) is the seam's constant.
   */
  @Get()
  list(
    @Principal() principal: Principal,
    @Query() query: ListTagsQuery,
  ): Promise<TagPage> {
    return this.tags.page(principal.sub, query);
  }

  @Post()
  async create(
    @Principal() principal: Principal,
    @Body() dto: CreateTagDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TagDto> {
    const { tag, created } = await this.tags.create(principal.sub, dto.name);
    res.status(created ? 201 : 200);
    return tag;
  }

  // Literal route declared before the `:id` routes.
  @Post('resolve')
  @HttpCode(201)
  resolve(
    @Principal() principal: Principal,
    @Body() dto: ResolveTagsDto,
  ): Promise<Array<{ id: number; name: string }>> {
    return this.tags.resolve(principal.sub, dto.ids);
  }

  @Patch(':id')
  rename(
    @Principal() principal: Principal,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTagDto,
  ): Promise<TagDto> {
    return this.tags.rename(principal.sub, id, dto.name, dto.expectedVersion);
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(
    @Principal() principal: Principal,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ ok: true }> {
    await this.tags.remove(principal.sub, id);
    return { ok: true };
  }
}
