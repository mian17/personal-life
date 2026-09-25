import { NextResponse, type NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { createNote } from '@/lib/api';
import { apiErrorStatus, readFlushPayload } from '@/lib/flush-payload';

export async function POST(req: NextRequest) {
  const payload = await readFlushPayload(req);
  if (!payload.ok) {
    return NextResponse.json({ error: payload.error }, { status: 400 });
  }

  try {
    const note = await createNote({ body: payload.body, tags: payload.tags });
    return NextResponse.json(
      { ok: true, id: note.id, version: note.version, updatedAt: note.updatedAt },
      { status: 201 },
    );
  } catch (error) {
    // Let Next's control-flow errors (e.g. the login redirect from requireSession)
    // pass through instead of being turned into an upstream 502.
    unstable_rethrow(error);
    const status = apiErrorStatus(error);
    if (status === 400) return NextResponse.json({ error: 'invalid input' }, { status: 400 });
    return NextResponse.json({ error: 'upstream error' }, { status: 502 });
  }
}
