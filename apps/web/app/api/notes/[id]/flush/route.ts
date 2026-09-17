import { NextResponse, type NextRequest } from 'next/server';
import { updateNote } from '@/lib/api';
import { apiErrorStatus, readFlushPayload } from '@/lib/flush-payload';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const payload = await readFlushPayload(req);
  if (!payload.ok) {
    return NextResponse.json({ error: payload.error }, { status: 400 });
  }

  try {
    const note = await updateNote(id, { body: payload.body, tags: payload.tags });
    return NextResponse.json({ ok: true, updatedAt: note.updatedAt });
  } catch (error) {
    const status = apiErrorStatus(error);
    if (status === 404) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (status === 400) return NextResponse.json({ error: 'invalid input' }, { status: 400 });
    return NextResponse.json({ error: 'upstream error' }, { status: 502 });
  }
}
