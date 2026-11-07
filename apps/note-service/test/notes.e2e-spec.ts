import { INestApplication } from '@nestjs/common';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { Note as NoteDto } from '@life/shared';
import { Note } from '../src/notes/note.entity';
import { configureVerifierEnv, JwtTestHarness } from './jwt-harness';

const TEST_DB = join(__dirname, 'test-life.db');
process.env.DB_PATH = TEST_DB;

// Every request now carries a minted JWT (Task 10); the guard is JWT-only.
// The token is minted once in beforeAll from an ephemeral local JWKS.
let token = '';
const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

describe('Notes API (e2e)', () => {
  let app: INestApplication;
  let harness: JwtTestHarness;

  beforeAll(async () => {
    harness = await new JwtTestHarness().start();
    configureVerifierEnv(harness);
    token = await harness.sign({ expiresIn: 3600 });

    rmSync(TEST_DB, { force: true });
    const { createApp } = await import('../src/app.factory');
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(TEST_DB, { force: true });
    await harness.stop();
  });

  it('rejects missing token', async () => {
    await request(app.getHttpServer()).get('/api/notes').expect(401);
  });

  it('rejects a bad payload', async () => {
    const res = await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: '' }),
    ).expect(400);
    expect(res.status).toBe(400);
  });

  it('stores and returns timestamps as UTC', async () => {
    const before = Date.now();
    const created = await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: 'utc check' }),
    ).expect(201);
    const after = Date.now();

    const iso = created.body.createdAt;
    expect(iso.endsWith('Z')).toBe(true);
    const ts = Date.parse(iso);
    expect(ts).toBeGreaterThanOrEqual(before - 2000);
    expect(ts).toBeLessThanOrEqual(after + 2000);

    const reread = await auth(
      request(app.getHttpServer()).get(`/api/notes/${created.body.id}`),
    ).expect(200);
    expect(reread.body.createdAt).toBe(iso);
  });

  it('hides registry ids that no longer have notes', async () => {
    const created = await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: 'x', tagIds: [77] }),
    ).expect(201);

    const withNote = await auth(request(app.getHttpServer()).get('/api/tags')).expect(200);
    // `{ tagUsages, nextCursor }` — the bare array this route used to answer with is gone.
    expect(Object.keys(withNote.body).sort()).toEqual(['nextCursor', 'tagUsages']);
    expect(withNote.body.tagUsages.map((t: { tagId: number }) => t.tagId)).toContain(77);

    await auth(request(app.getHttpServer()).delete(`/api/notes/${created.body.id}`)).expect(200);

    const afterDelete = await auth(request(app.getHttpServer()).get('/api/tags')).expect(200);
    expect(afterDelete.body.tagUsages.map((t: { tagId: number }) => t.tagId)).not.toContain(77);
  });

  it('pages the tag usage surface with no gap and no duplicate', async () => {
    // Five fresh ids, so this owner's usage surface has more rows than one page.
    for (const tagId of [10, 20, 30, 40, 50]) {
      await auth(request(app.getHttpServer()).post('/api/notes').send({ body: `u${tagId}`, tagIds: [tagId] })).expect(201);
    }

    const whole = await auth(request(app.getHttpServer()).get('/api/tags?limit=200')).expect(200);
    const expectedIds = (whole.body.tagUsages as Array<{ tagId: number }>).map((row) => row.tagId);

    const seen: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query = cursor === null ? { limit: '2' } : { limit: '2', cursor };
      const res = await auth(request(app.getHttpServer()).get('/api/tags').query(query)).expect(200);
      const page = res.body as { tagUsages: Array<{ tagId: number }>; nextCursor: string | null };
      expect(Object.keys(res.body).sort()).toEqual(['nextCursor', 'tagUsages']);
      expect(page.tagUsages.length).toBeLessThanOrEqual(2);
      seen.push(...page.tagUsages.map((row) => row.tagId));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 20);

    // The walk ended because the service said so, not because the guard tripped.
    expect(cursor).toBeNull();
    expect(pages).toBeGreaterThan(1);
    // `tagId ASC` across the whole surface, each id exactly once.
    expect(seen).toEqual(expectedIds);
    expect(new Set(seen).size).toBe(expectedIds.length);
  });

  it('supports the full note lifecycle with tagId filtering', async () => {
    const created = await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: 'hello', tagIds: [1] }),
    ).expect(201);
    const id = created.body.id;
    expect(created.body.tagIds).toHaveLength(1);

    const listed = await auth(request(app.getHttpServer()).get('/api/notes')).expect(200);
    expect(listed.body.notes.map((n: { body: string }) => n.body)).toContain('hello');

    const filtered = await auth(
      request(app.getHttpServer()).get('/api/notes?tagId=1'),
    ).expect(200);
    expect(filtered.body.notes.map((n: { id: string }) => n.id)).toContain(id);

    const updated = await auth(
      request(app.getHttpServer())
        .patch(`/api/notes/${id}`)
        .send({ body: 'hello edited', tagIds: [2] }),
    ).expect(200);
    expect(updated.body.body).toBe('hello edited');
    expect(updated.body.tagIds).toEqual([2]);

    await auth(request(app.getHttpServer()).delete(`/api/notes/${id}`)).expect(200);
    await auth(request(app.getHttpServer()).get(`/api/notes/${id}`)).expect(404);
  });

  it('creates notes with the documented initial version', async () => {
    const created = await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: 'versioned create' }),
    ).expect(201);
    expect(created.body.version).toBe(0);
  });

  it('returns version as a number on GET', async () => {
    const created = await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: 'versioned read' }),
    ).expect(201);

    const fetched = await auth(
      request(app.getHttpServer()).get(`/api/notes/${created.body.id}`),
    ).expect(200);
    expect(typeof fetched.body.version).toBe('number');
    expect(fetched.body.version).toBe(0);
  });

  it('increments version on a PATCH with the correct expectedVersion', async () => {
    const created = await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: 'optimistic ok' }),
    ).expect(201);

    const updated = await auth(
      request(app.getHttpServer())
        .patch(`/api/notes/${created.body.id}`)
        .send({ body: 'optimistic edited', expectedVersion: 0 }),
    ).expect(200);
    expect(updated.body.version).toBe(1);
    expect(updated.body.body).toBe('optimistic edited');
  });

  it('rejects a stale expectedVersion with 409 and leaves the note unchanged', async () => {
    const created = await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: 'conflict base' }),
    ).expect(201);

    const first = await auth(
      request(app.getHttpServer())
        .patch(`/api/notes/${created.body.id}`)
        .send({ body: 'conflict first', expectedVersion: 0 }),
    ).expect(200);
    expect(first.body.version).toBe(1);

    await auth(
      request(app.getHttpServer())
        .patch(`/api/notes/${created.body.id}`)
        .send({ body: 'conflict stale', expectedVersion: 0 }),
    ).expect(409);

    const reread = await auth(
      request(app.getHttpServer()).get(`/api/notes/${created.body.id}`),
    ).expect(200);
    expect(reread.body.body).toBe('conflict first');
    expect(reread.body.version).toBe(1);
  });

  it('still patches without expectedVersion (legacy last-write-wins)', async () => {
    const created = await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: 'legacy base' }),
    ).expect(201);

    const updated = await auth(
      request(app.getHttpServer())
        .patch(`/api/notes/${created.body.id}`)
        .send({ body: 'legacy edited' }),
    ).expect(200);
    expect(updated.body.body).toBe('legacy edited');
    expect(updated.body.version).toBe(1);
  });

  it('moves a deleted note to trash and hides it from the main list', async () => {
    const created = await auth(
      request(app.getHttpServer())
        .post('/api/notes')
        .send({ body: 'trash me', tagIds: [88] }),
    ).expect(201);
    const id = created.body.id;

    await auth(request(app.getHttpServer()).delete(`/api/notes/${id}`)).expect(200);

    const listed = await auth(request(app.getHttpServer()).get('/api/notes')).expect(200);
    expect(listed.body.notes.map((n: { id: string }) => n.id)).not.toContain(id);

    const trash = await auth(request(app.getHttpServer()).get('/api/notes/trash')).expect(200);
    const trashed = trash.body.notes.find((n: { id: string }) => n.id === id);
    expect(trashed).toBeDefined();
    expect(trashed.deletedAt).not.toBeNull();
  });

  it('returns 404 for a trashed note on GET /:id and PATCH', async () => {
    const created = await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: 'hidden' }),
    ).expect(201);
    const id = created.body.id;

    await auth(request(app.getHttpServer()).delete(`/api/notes/${id}`)).expect(200);
    const read = await auth(request(app.getHttpServer()).get(`/api/notes/${id}`)).expect(404);
    expect(read.status).toBe(404);
    const patched = await auth(
      request(app.getHttpServer()).patch(`/api/notes/${id}`).send({ body: 'nope' }),
    ).expect(404);
    expect(patched.status).toBe(404);
  });

  it('restores a trashed note with the same createdAt, tagIds, and version', async () => {
    const created = await auth(
      request(app.getHttpServer())
        .post('/api/notes')
        .send({ body: 'restore me', tagIds: [55] }),
    ).expect(201);
    const id = created.body.id;
    const createdAt = created.body.createdAt;

    const updated = await auth(
      request(app.getHttpServer())
        .patch(`/api/notes/${id}`)
        .send({ body: 'restore me edited' }),
    ).expect(200);
    expect(updated.body.version).toBe(1);

    await auth(request(app.getHttpServer()).delete(`/api/notes/${id}`)).expect(200);

    const restored = await auth(
      request(app.getHttpServer()).post(`/api/notes/${id}/restore`),
    ).expect(201);
    expect(restored.body.createdAt).toBe(createdAt);
    expect(restored.body.tagIds).toEqual([55]);
    expect(restored.body.version).toBe(1);
    expect(restored.body.deletedAt).toBeNull();

    const listed = await auth(request(app.getHttpServer()).get('/api/notes')).expect(200);
    expect(listed.body.notes.map((n: { id: string }) => n.id)).toContain(id);
  });

  it('does not change version on trash or restore', async () => {
    const created = await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: 'version stable' }),
    ).expect(201);
    const id = created.body.id;
    expect(created.body.version).toBe(0);

    await auth(request(app.getHttpServer()).delete(`/api/notes/${id}`)).expect(200);
    const trash = await auth(request(app.getHttpServer()).get('/api/notes/trash')).expect(200);
    const trashed = trash.body.notes.find((n: { id: string }) => n.id === id);
    expect(trashed.version).toBe(0);

    const restored = await auth(
      request(app.getHttpServer()).post(`/api/notes/${id}/restore`),
    ).expect(201);
    expect(restored.body.version).toBe(0);
  });

  it('permanently deletes a note from trash and 404s on a second call', async () => {
    const created = await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: 'delete forever' }),
    ).expect(201);
    const id = created.body.id;

    await auth(request(app.getHttpServer()).delete(`/api/notes/${id}`)).expect(200);
    await auth(request(app.getHttpServer()).delete(`/api/notes/${id}/permanent`)).expect(200);

    const trash = await auth(request(app.getHttpServer()).get('/api/notes/trash')).expect(200);
    expect(trash.body.notes.map((n: { id: string }) => n.id)).not.toContain(id);

    await auth(request(app.getHttpServer()).delete(`/api/notes/${id}/permanent`)).expect(404);
  });

  it('empties the trash and returns the deleted count', async () => {
    const a = await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: 'empty a' }),
    ).expect(201);
    const b = await auth(
      request(app.getHttpServer()).post('/api/notes').send({ body: 'empty b' }),
    ).expect(201);

    await auth(request(app.getHttpServer()).delete(`/api/notes/${a.body.id}`)).expect(200);
    await auth(request(app.getHttpServer()).delete(`/api/notes/${b.body.id}`)).expect(200);

    const emptied = await auth(request(app.getHttpServer()).delete('/api/notes/trash')).expect(200);
    expect(emptied.body.ok).toBe(true);
    expect(emptied.body.count).toBeGreaterThanOrEqual(2);

    const trash = await auth(request(app.getHttpServer()).get('/api/notes/trash')).expect(200);
    expect(trash.body.notes).toHaveLength(0);
  });

  describe('content order', () => {
    const oldestRank = '2020-01-01T00:00:00.000Z';
    const middleRank = '2020-01-02T00:00:00.000Z';
    const newestRank = '2020-01-03T00:00:00.000Z';

    it('moves an edited note above a newer one and leaves a retag in place', async () => {
      const older = await postNote('order older');
      const newer = await postNote('order newer');
      await pinContentEdit(older.id, oldestRank);
      await pinContentEdit(newer.id, middleRank);

      expect(await listedOrderOf([older.id, newer.id])).toEqual([newer.id, older.id]);

      const edited = await patchNote(older.id, { body: 'order older edited' });
      expect(edited.version).toBe(1);
      expect(await listedOrderOf([older.id, newer.id])).toEqual([older.id, newer.id]);

      const retagged = await patchNote(older.id, { tagIds: [3] });
      expect(retagged.version).toBe(2);
      expect(await listedOrderOf([older.id, newer.id])).toEqual([older.id, newer.id]);
    });

    it('ranks a fresh create above an earlier create without pinning (AC3)', async () => {
      const first = await postNote('fresh first');
      // `createdAt`/`updatedAt` come from SQLite CURRENT_TIMESTAMP (whole-second
      // truncated) while the create stamp keeps milliseconds, so cross the next
      // second boundary: the case must prove create() stamped the column, not
      // that a clock tie was broken by the id DESC rule.
      await waitForClockPast(first.createdAt);
      const second = await postNote('fresh second');

      const firstStamp = await contentUpdatedAtOf(first.id);
      const secondStamp = await contentUpdatedAtOf(second.id);
      expect(firstStamp).not.toBeNull();
      expect(secondStamp).not.toBeNull();
      expect(secondStamp!.getTime()).toBeGreaterThan(firstStamp!.getTime());
      expect(await listedOrderOf([first.id, second.id])).toEqual([second.id, first.id]);
    });

    it('ranks a legacy NULL contentUpdatedAt row by its createdAt, neither last nor newest (AC5)', async () => {
      const legacy = await postNote('legacy null');
      const old = await postNote('legacy old');
      const fresh = await postNote('legacy future');
      await pinContentEdit(old.id, oldestRank);
      await pinContentEdit(fresh.id, '2030-01-01T00:00:00.000Z');
      // A pre-backfill row keeps NULL in the real DB; its createdAt (now) sits
      // between the 2020 and 2030 pinned ranks, so a correct fallback lands it in
      // the middle — NULL-as-min would put it last, NULL-as-max first.
      await noteRepository().update(legacy.id, { contentUpdatedAt: null });

      expect(await contentUpdatedAtOf(legacy.id)).toBeNull();
      expect(await listedOrderOf([old.id, legacy.id, fresh.id])).toEqual([
        fresh.id,
        legacy.id,
        old.id,
      ]);
    });

    it('leaves updatedAt a generic row timestamp while contentUpdatedAt tracks content (AC6)', async () => {
      const created = await postNote('updatedAt probe');
      await pinContentEdit(created.id, middleRank);
      const before = await rowTimestampsOf(created.id);

      // A tag-only write still advances `updatedAt` (generic row timestamp) but
      // must not move `contentUpdatedAt` — the two fields are not the same field.
      await waitForClockPast(before.updatedAt.toISOString());
      const retagged = await patchNote(created.id, { tagIds: [4] });
      expect(retagged.version).toBe(1);
      const afterRetag = await rowTimestampsOf(created.id);
      expect(afterRetag.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
      expect(afterRetag.contentUpdatedAt!.toISOString()).toBe(middleRank);

      await waitForClockPast(afterRetag.updatedAt.toISOString());
      await deleteNote(created.id);
      const afterTrash = await rowTimestampsOf(created.id);
      expect(afterTrash.updatedAt.getTime()).toBeGreaterThan(afterRetag.updatedAt.getTime());
      expect(afterTrash.contentUpdatedAt!.toISOString()).toBe(middleRank);

      await waitForClockPast(afterTrash.updatedAt.toISOString());
      await restoreNote(created.id);
      const afterRestore = await rowTimestampsOf(created.id);
      expect(afterRestore.updatedAt.getTime()).toBeGreaterThan(afterTrash.updatedAt.getTime());
      expect(afterRestore.contentUpdatedAt!.toISOString()).toBe(middleRank);
    });

    it('leaves list position unchanged through trash and restore', async () => {
      const older = await postNote('restore older');
      const newer = await postNote('restore newer');
      await pinContentEdit(older.id, oldestRank);
      await pinContentEdit(newer.id, newestRank);
      expect(await listedOrderOf([older.id, newer.id])).toEqual([newer.id, older.id]);

      await deleteNote(newer.id);
      await restoreNote(newer.id);

      expect(await listedOrderOf([older.id, newer.id])).toEqual([newer.id, older.id]);
    });

    it('returns every note exactly once when walking limit=1 pages', async () => {
      const oldest = await postNote('page oldest');
      const middle = await postNote('page middle');
      const newest = await postNote('page newest');
      await pinContentEdit(oldest.id, oldestRank);
      await pinContentEdit(middle.id, middleRank);
      await pinContentEdit(newest.id, newestRank);

      const walked = await walkNoteIds(1);
      expect([...new Set(walked)]).toHaveLength(walked.length);

      const listed = await listedNoteIds();
      expect([...walked].sort((a: string, b: string) => a.localeCompare(b))).toEqual([...listed].sort((a: string, b: string) => a.localeCompare(b)));

      const walkedOrder = walked.filter((id) => [oldest.id, middle.id, newest.id].includes(id));
      expect(walkedOrder).toEqual([newest.id, middle.id, oldest.id]);
    });

    it('breaks an equal rank by id descending', async () => {
      const left = await postNote('tie left');
      const right = await postNote('tie right');
      await pinContentEdit(left.id, middleRank);
      await pinContentEdit(right.id, middleRank);

      const expected = [left.id, right.id].sort((a, b) => b.localeCompare(a));
      expect(await listedOrderOf([left.id, right.id])).toEqual(expected);
    });

    it('lists trash by newest deletion first', async () => {
      const deletedEarlier = await postNote('trash order earlier');
      const deletedLater = await postNote('trash order later');
      await deleteNote(deletedEarlier.id);
      await deleteNote(deletedLater.id);
      await pinDeletion(deletedEarlier.id, oldestRank);
      await pinDeletion(deletedLater.id, newestRank);

      const ourTrash = (await listedTrashIds()).filter((id) =>
        [deletedEarlier.id, deletedLater.id].includes(id),
      );
      expect(ourTrash).toEqual([deletedLater.id, deletedEarlier.id]);
    });

    /** Prior cases share this DB, so a case narrows the list to the ids it created. */
    async function listedOrderOf(ids: string[]): Promise<string[]> {
      const listed = await listedNoteIds();
      return listed.filter((id) => ids.includes(id));
    }

    async function listedNoteIds(): Promise<string[]> {
      const listed = await apiGet('/api/notes?limit=200').expect(200);
      return listed.body.notes.map((note: { id: string }) => note.id);
    }

    async function listedTrashIds(): Promise<string[]> {
      const listed = await apiGet('/api/notes/trash?limit=200').expect(200);
      return listed.body.notes.map((note: { id: string }) => note.id);
    }

    async function walkNoteIds(limit: number): Promise<string[]> {
      const walked: string[] = [];
      let cursor: string | null = null;
      for (;;) {
        const page = await fetchNotePage(limit, cursor);
        walked.push(...page.ids);
        if (page.nextCursor === null) return walked;
        cursor = page.nextCursor;
      }
    }

    async function fetchNotePage(
      limit: number,
      cursor: string | null,
    ): Promise<{ ids: string[]; nextCursor: string | null }> {
      const query = cursor === null ? `limit=${limit}` : `limit=${limit}&cursor=${encodeURIComponent(cursor)}`;
      const page = await apiGet(`/api/notes?${query}`).expect(200);
      return {
        ids: page.body.notes.map((note: { id: string }) => note.id),
        nextCursor: page.body.nextCursor,
      };
    }

    async function postNote(body: string, tagIds?: number[]): Promise<NoteDto> {
      const created = await auth(
        request(app.getHttpServer()).post('/api/notes').send({ body, tagIds }),
      ).expect(201);
      return created.body;
    }

    async function patchNote(
      id: string,
      fields: { body?: string; tagIds?: number[] },
    ): Promise<NoteDto> {
      const updated = await auth(
        request(app.getHttpServer()).patch(`/api/notes/${id}`).send(fields),
      ).expect(200);
      return updated.body;
    }

    async function deleteNote(id: string): Promise<void> {
      await auth(request(app.getHttpServer()).delete(`/api/notes/${id}`)).expect(200);
    }

    async function restoreNote(id: string): Promise<void> {
      await auth(request(app.getHttpServer()).post(`/api/notes/${id}/restore`)).expect(201);
    }

    function apiGet(path: string): request.Test {
      return auth(request(app.getHttpServer()).get(path));
    }

    /** Two creates can share a millisecond, so a case pins the rank instead of trusting the clock. */
    async function pinContentEdit(id: string, contentUpdatedAt: string): Promise<void> {
      await noteRepository().update(id, { contentUpdatedAt: new Date(contentUpdatedAt) });
    }

    async function pinDeletion(id: string, deletedAt: string): Promise<void> {
      await noteRepository().update(id, { deletedAt: new Date(deletedAt) });
    }

    async function contentUpdatedAtOf(id: string): Promise<Date | null> {
      return (await noteRepository().findOne({ where: { id } }))!.contentUpdatedAt;
    }

    async function rowTimestampsOf(
      id: string,
    ): Promise<{ updatedAt: Date; contentUpdatedAt: Date | null }> {
      const row = (await noteRepository().findOne({ where: { id } }))!;
      return { updatedAt: row.updatedAt, contentUpdatedAt: row.contentUpdatedAt };
    }

    /**
     * Spin until the wall clock is at least one second past `iso`. `createdAt`
     * and `updatedAt` are written by SQLite `CURRENT_TIMESTAMP`, which truncates
     * to a whole second, so only crossing the next second boundary guarantees a
     * later stored timestamp (a sub-second wait can round back to the same value).
     */
    async function waitForClockPast(iso: string): Promise<void> {
      const deadline = Date.parse(iso) + 1000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }

    function noteRepository() {
      return app.get(DataSource).getRepository(Note);
    }
  });
});
