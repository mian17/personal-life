import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Principal } from '../auth/principal';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { ListNotesQuery } from './dto/list-notes.query';
import { NotesService } from './notes.service';

@Controller('api/notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Post()
  create(@Principal() principal: Principal, @Body() dto: CreateNoteDto) {
    return this.notes.create(principal.sub, dto.body, dto.tagIds);
  }

  @Get()
  findAll(@Principal() principal: Principal, @Query() query: ListNotesQuery) {
    return this.notes.findAll(principal.sub, query);
  }

  @Get('trash')
  findTrash(@Principal() principal: Principal, @Query() query: ListNotesQuery) {
    return this.notes.findTrash(principal.sub, query);
  }

  @Delete('trash')
  async emptyTrash(@Principal() principal: Principal) {
    const { count } = await this.notes.emptyTrash(principal.sub);
    return { ok: true, count };
  }

  @Get(':id')
  findOne(@Principal() principal: Principal, @Param('id') id: string) {
    return this.notes.findOne(principal.sub, id);
  }

  @Patch(':id')
  update(@Principal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateNoteDto) {
    return this.notes.update(principal.sub, id, dto.body, dto.tagIds, dto.expectedVersion);
  }

  @Post(':id/restore')
  restore(@Principal() principal: Principal, @Param('id') id: string) {
    return this.notes.restore(principal.sub, id);
  }

  @Delete(':id/permanent')
  async removePermanent(@Principal() principal: Principal, @Param('id') id: string) {
    await this.notes.removePermanent(principal.sub, id);
    return { ok: true };
  }

  @Delete(':id')
  async remove(@Principal() principal: Principal, @Param('id') id: string) {
    await this.notes.remove(principal.sub, id);
    return { ok: true };
  }
}
