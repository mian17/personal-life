import { readFlushPayload, apiErrorStatus } from '@/lib/flush-payload';
import { ApiError } from '@/lib/api-error';

function request(body: unknown): Request {
  return new Request('http://localhost/api/notes/flush', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('readFlushPayload', () => {
  it('accepts a body with inline names and attached ids', async () => {
    const payload = await readFlushPayload(
      request({ body: 'hi #errand', inlineTagNames: ['errand'], tagIds: [1, 2] }),
    );
    expect(payload).toEqual({
      ok: true,
      body: 'hi #errand',
      inlineTagNames: ['errand'],
      tagIds: [1, 2],
    });
  });

  it('defaults both tag fields to empty arrays when omitted', async () => {
    const payload = await readFlushPayload(request({ body: 'plain' }));
    expect(payload).toEqual({ ok: true, body: 'plain', inlineTagNames: [], tagIds: [] });
  });

  it('rejects a non-string body', async () => {
    expect(await readFlushPayload(request({ body: 3 }))).toEqual({
      ok: false,
      error: 'invalid body',
    });
  });

  it('rejects non-integer tag ids', async () => {
    expect(await readFlushPayload(request({ body: 'x', tagIds: ['1'] }))).toEqual({
      ok: false,
      error: 'invalid tag ids',
    });
  });

  it('rejects zero/negative tag ids', async () => {
    expect(await readFlushPayload(request({ body: 'x', tagIds: [0] }))).toEqual({
      ok: false,
      error: 'invalid tag ids',
    });
  });

  it('rejects an over-long inline tag name', async () => {
    expect(
      await readFlushPayload(request({ body: 'x', inlineTagNames: ['y'.repeat(200)] })),
    ).toEqual({ ok: false, error: 'invalid inline tags' });
  });

  it('passthroughs a valid expectedVersion', async () => {
    const payload = await readFlushPayload(request({ body: 'x', expectedVersion: 4 }));
    expect(payload).toEqual({
      ok: true,
      body: 'x',
      inlineTagNames: [],
      tagIds: [],
      expectedVersion: 4,
    });
  });

  it('rejects a malformed expectedVersion', async () => {
    expect(await readFlushPayload(request({ body: 'x', expectedVersion: -1 }))).toEqual({
      ok: false,
      error: 'invalid version',
    });
  });

  it('rejects invalid JSON', async () => {
    const bad = new Request('http://localhost/api/notes/flush', {
      method: 'POST',
      body: 'not json',
    });
    expect(await readFlushPayload(bad)).toEqual({ ok: false, error: 'invalid json' });
  });
});

describe('apiErrorStatus', () => {
  it('reads the status off an ApiError', () => {
    expect(apiErrorStatus(new ApiError(409, 'API 409 on /api/notes/1'))).toBe(409);
  });

  it('falls back to parsing the legacy message shape', () => {
    expect(apiErrorStatus(new Error('API 404 on /api/notes/1'))).toBe(404);
  });

  it('returns null for an unrelated error', () => {
    expect(apiErrorStatus(new Error('boom'))).toBeNull();
  });
});
