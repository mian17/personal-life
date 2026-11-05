import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Principal } from '@life/service-kit';
import {
  BatchCreateNotesDto,
  BatchDeleteNotesDto,
  BatchUpdateNotesDto,
} from './dto/batch-notes.dto';
import { NotesService } from './notes.service';

/**
 * The `notes` batch trio (`SPEC-note-service.md` §5).
 *
 * Prefix-less controller with full, colon-escaped method paths. Nest joins the
 * controller and method paths with a slash, so `@Post(':batchCreate')` on a
 * prefixed controller could only ever register the parameter route
 * `/api/notes/:batchCreate` — never the literal AIP URI.
 */
@Controller()
export class NotesBatchController {
  constructor(private readonly notes: NotesService) {}

  @Post(String.raw`api/notes\:batchCreate`)
  @HttpCode(201)
  createMany(@Principal() principal: Principal, @Body() dto: BatchCreateNotesDto) {
    return this.notes.createMany(principal.sub, dto.items);
  }

  @Post(String.raw`api/notes\:batchUpdate`)
  @HttpCode(200)
  updateMany(@Principal() principal: Principal, @Body() dto: BatchUpdateNotesDto) {
    return this.notes.updateMany(principal.sub, dto.items);
  }

  @Post(String.raw`api/notes\:batchDelete`)
  @HttpCode(200)
  deleteMany(@Principal() principal: Principal, @Body() dto: BatchDeleteNotesDto) {
    return this.notes.removeMany(principal.sub, dto.items);
  }
}
