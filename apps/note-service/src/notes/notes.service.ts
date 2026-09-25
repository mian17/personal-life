import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { Note } from './note.entity';
import { Tag } from './tag.entity';
import { hashOptions, NOTES_CACHE, NotesCache } from './notes-cache';
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
    deletedAt: note.deletedAt ? note.deletedAt.toISOString() : null,
    version: note.version,
  };
}

@Injectable()
export class NotesService {
  constructor(
    @InjectRepository(Note) private readonly notes: Repository<Note>,
    @InjectRepository(Tag) private readonly tags: Repository<Tag>,
    @Inject(NOTES_CACHE) private readonly cache: NotesCache,
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

  async create(sub: string, body: string, tagNames: string[] | undefined): Promise<NoteDto> {
    const note = this.notes.create({
      body,
      ownerSub: sub,
      version: 0,
      deletedAt: null,
      tags: await this.resolveTags(normalizeTags(tagNames)),
    });
    const saved = await this.notes.save(note);
    // Bump AFTER the insert: pre-mutation reads were born under the old
    // generation and die here. A thrown save never bumps (cache stays honest).
    await this.cache.bumpGeneration();
    return toDto(saved);
  }

  async findAll(
    sub: string,
    opts: {
      tag?: string;
      q?: string;
      limit?: number;
      cursor?: string;
    },
  ): Promise<NotePage> {
    const limit = opts.limit ?? 50;
    const cacheKey = `note:list:${hashOptions({
      tag: opts.tag,
      q: opts.q,
      limit: opts.limit,
      cursor: opts.cursor,
    })}`;
    return this.cache.getThrough(cacheKey, async () => {
      const qb = this.notes
        .createQueryBuilder('note')
        .leftJoinAndSelect('note.tags', 'tag')
        .orderBy('note.createdAt', 'DESC')
        .addOrderBy('note.id', 'DESC')
        .where('note.deletedAt IS NULL')
        .andWhere('note.ownerSub = :sub', { sub })
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
    });
  }

  async findTrash(
    sub: string,
    opts: { limit?: number; cursor?: string },
  ): Promise<NotePage> {
    const limit = opts.limit ?? 50;
    const cacheKey = `note:trash:${hashOptions({ limit: opts.limit, cursor: opts.cursor })}`;
    return this.cache.getThrough(cacheKey, async () => {
      const qb = this.notes
        .createQueryBuilder('note')
        .leftJoinAndSelect('note.tags', 'tag')
        .where('note.deletedAt IS NOT NULL')
        .andWhere('note.ownerSub = :sub', { sub })
        .orderBy('note.deletedAt', 'DESC')
        .addOrderBy('note.id', 'DESC')
        .take(limit + 1);

      if (opts.cursor) {
        const [deletedAt, id] = Buffer.from(opts.cursor, 'base64').toString().split('|');
        qb.andWhere(
          '(note.deletedAt < :deletedAt OR (note.deletedAt = :deletedAt AND note.id < :id))',
          { deletedAt, id },
        );
      }

      const rows = await qb.getMany();
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];
      const nextCursor =
        hasMore && last
          ? Buffer.from(`${last.deletedAt!.toISOString()}|${last.id}`).toString('base64')
          : null;
      return { notes: page.map(toDto), nextCursor };
    });
  }

  async findOne(sub: string, id: string): Promise<NoteDto> {
    return this.cache.getThrough(`note:one:${id}`, async () => {
      const note = await this.notes.findOne({
        where: { id, ownerSub: sub, deletedAt: IsNull() },
        relations: { tags: true },
      });
      if (!note) throw new NotFoundException('Note not found');
      return toDto(note);
    });
  }

  async update(
    sub: string,
    id: string,
    body?: string,
    tagNames?: string[],
    expectedVersion?: number,
  ): Promise<NoteDto> {
    const note = await this.notes.findOne({
      where: { id, ownerSub: sub, deletedAt: IsNull() },
      relations: { tags: true },
    });
    if (!note) throw new NotFoundException('Note not found');
    if (expectedVersion !== undefined && note.version !== expectedVersion) {
      throw new ConflictException('Note was modified');
    }
    if (body !== undefined) note.body = body;
    if (tagNames !== undefined) note.tags = await this.resolveTags(normalizeTags(tagNames));
    note.version += 1;
    const saved = await this.notes.save(note);
    // Bump AFTER the mutation — see bumpGeneration(); a 409 above never bumps.
    await this.cache.bumpGeneration();
    return toDto(saved);
  }

  async remove(sub: string, id: string): Promise<void> {
    const note = await this.notes.findOne({ where: { id, ownerSub: sub, deletedAt: IsNull() } });
    if (!note) throw new NotFoundException('Note not found');
    note.deletedAt = new Date();
    await this.notes.save(note);
    // Bump AFTER the mutation: pre-mutation entries die here.
    await this.cache.bumpGeneration();
  }

  async restore(sub: string, id: string): Promise<NoteDto> {
    const note = await this.notes.findOne({
      where: { id, ownerSub: sub, deletedAt: Not(IsNull()) },
      relations: { tags: true },
    });
    if (!note) throw new NotFoundException('Note not found');
    note.deletedAt = null;
    const saved = await this.notes.save(note);
    await this.cache.bumpGeneration();
    return toDto(saved);
  }

  async removePermanent(sub: string, id: string): Promise<void> {
    const result = await this.notes.delete({ id, ownerSub: sub, deletedAt: Not(IsNull()) });
    if (!result.affected) throw new NotFoundException('Note not found');
    // Only a successful delete reaches the bump.
    await this.cache.bumpGeneration();
  }

  async emptyTrash(sub: string): Promise<{ count: number }> {
    const result = await this.notes.delete({ ownerSub: sub, deletedAt: Not(IsNull()) });
    await this.cache.bumpGeneration();
    return { count: result.affected ?? 0 };
  }

  async listTags(): Promise<{ id: number; name: string }[]> {
    return this.cache.getThrough('note:tags', async () => {
      const tags = await this.tags
        .createQueryBuilder('tag')
        .innerJoin('tag.notes', 'note')
        .where('note.deletedAt IS NULL')
        .orderBy('tag.name', 'ASC')
        .getMany();
      return tags.map((t) => ({ id: t.id, name: t.name }));
    });
  }
}
