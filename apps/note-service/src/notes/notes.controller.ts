import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { ListNotesQuery } from './dto/list-notes.query';
import { NotesService } from './notes.service';

@Controller('api/notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Post()
  create(@Body() dto: CreateNoteDto) {
    return this.notes.create(dto.body, dto.tags);
  }

  @Get()
  findAll(@Query() query: ListNotesQuery) {
    return this.notes.findAll(query);
  }

  @Get('trash')
  findTrash(@Query() query: ListNotesQuery) {
    return this.notes.findTrash(query);
  }

  @Delete('trash')
  async emptyTrash() {
    const { count } = await this.notes.emptyTrash();
    return { ok: true, count };
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.notes.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateNoteDto) {
    return this.notes.update(id, dto.body, dto.tags, dto.expectedVersion);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string) {
    return this.notes.restore(id);
  }

  @Delete(':id/permanent')
  async removePermanent(@Param('id') id: string) {
    await this.notes.removePermanent(id);
    return { ok: true };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.notes.remove(id);
    return { ok: true };
  }
}
