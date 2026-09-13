import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Note } from './note.entity';
import { Tag } from './tag.entity';
import type { Note as NoteDto, NotePage } from '@life/shared';

function normalizeTags(tags: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags ?? []) {
    const name = raw.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

function toDto(note: Note): NoteDto {
  return {
    id: note.id,
    body: note.body,
    tags: (note.tags ?? []).map((t) => ({ id: t.id, name: t.name })),
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

@Injectable()
export class NotesService {
  constructor(
    @InjectRepository(Note) private readonly notes: Repository<Note>,
    @InjectRepository(Tag) private readonly tags: Repository<Tag>,
  ) {}

  private async resolveTags(names: string[]): Promise<Tag[]> {
    const result: Tag[] = [];
    for (const name of names) {
      let tag = await this.tags
        .createQueryBuilder('tag')
        .where('LOWER(tag.name) = LOWER(:name)', { name })
        .getOne();
      if (!tag) tag = await this.tags.save(this.tags.create({ name }));
      result.push(tag);
    }
    return result;
  }

  async create(body: string, tagNames: string[] | undefined): Promise<NoteDto> {
    const note = this.notes.create({
      body,
      tags: await this.resolveTags(normalizeTags(tagNames)),
    });
    return toDto(await this.notes.save(note));
  }

  async findAll(opts: {
    tag?: string;
    q?: string;
    limit?: number;
    cursor?: string;
  }): Promise<NotePage> {
    const limit = opts.limit ?? 50;
    const qb = this.notes
      .createQueryBuilder('note')
      .leftJoinAndSelect('note.tags', 'tag')
      .orderBy('note.createdAt', 'DESC')
      .addOrderBy('note.id', 'DESC')
      .take(limit + 1);

    if (opts.tag) {
      qb.andWhere('LOWER(tag.name) = LOWER(:tag)', { tag: opts.tag });
    }
    if (opts.q) {
      qb.andWhere('note.body LIKE :q', { q: `%${opts.q}%` });
    }
    if (opts.cursor) {
      const [createdAt, id] = Buffer.from(opts.cursor, 'base64').toString().split('|');
      qb.andWhere(
        '(note.createdAt < :createdAt OR (note.createdAt = :createdAt AND note.id < :id))',
        { createdAt, id },
      );
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? Buffer.from(`${last.createdAt.toISOString()}|${last.id}`).toString('base64')
        : null;
    return { notes: page.map(toDto), nextCursor };
  }

  async findOne(id: string): Promise<NoteDto> {
    const note = await this.notes.findOne({ where: { id }, relations: { tags: true } });
    if (!note) throw new NotFoundException('Note not found');
    return toDto(note);
  }

  async update(id: string, body?: string, tagNames?: string[]): Promise<NoteDto> {
    const note = await this.notes.findOne({ where: { id }, relations: { tags: true } });
    if (!note) throw new NotFoundException('Note not found');
    if (body !== undefined) note.body = body;
    if (tagNames !== undefined) note.tags = await this.resolveTags(normalizeTags(tagNames));
    return toDto(await this.notes.save(note));
  }

  async remove(id: string): Promise<void> {
    const result = await this.notes.delete({ id });
    if (!result.affected) throw new NotFoundException('Note not found');
  }

  async listTags(): Promise<{ id: number; name: string }[]> {
    const tags = await this.tags
      .createQueryBuilder('tag')
      .innerJoin('tag.notes', 'note')
      .orderBy('tag.name', 'ASC')
      .getMany();
    return tags.map((t) => ({ id: t.id, name: t.name }));
  }
}
