import { NextResponse, type NextRequest } from 'next/server';
import { NOTE_BODY_MAX } from '@life/shared';
import { updateNote } from '@/lib/api';
import { apiErrorStatus, isTagArray } from '@/lib/flush-payload';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const { body, tags } = payload as { body?: unknown; tags?: unknown };
  if (typeof body !== 'string' || body.length > NOTE_BODY_MAX) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  if (!isTagArray(tags)) {
    return NextResponse.json({ error: 'invalid tags' }, { status: 400 });
  }

  try {
    const note = await updateNote(id, { body, tags });
    return NextResponse.json({ ok: true, updatedAt: note.updatedAt });
  } catch (error) {
    const status = apiErrorStatus(error);
    if (status === 404) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (status === 400) return NextResponse.json({ error: 'invalid input' }, { status: 400 });
    return NextResponse.json({ error: 'upstream error' }, { status: 502 });
  }
}
