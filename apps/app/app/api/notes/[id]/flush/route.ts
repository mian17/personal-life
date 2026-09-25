import { NextResponse, type NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { getNote, updateNote } from '@/lib/api';
import { apiErrorStatus, readFlushPayload } from '@/lib/flush-payload';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const payload = await readFlushPayload(req);
  if (!payload.ok) {
    return NextResponse.json({ error: payload.error }, { status: 400 });
  }

  try {
    const note = await updateNote(id, {
      body: payload.body,
      tags: payload.tags,
      expectedVersion: payload.expectedVersion,
    });
    return NextResponse.json({ ok: true, version: note.version, updatedAt: note.updatedAt });
  } catch (error) {
    // Let Next's control-flow errors (e.g. the login redirect from requireSession)
    // pass through instead of being turned into an upstream 502.
    unstable_rethrow(error);
    const status = apiErrorStatus(error);
    if (status === 409) {
      // Hand the client the current server note so it can offer "Load latest"
      // without a second round trip. If the note vanished meanwhile, it is a 404.
      try {
        const note = await getNote(id);
        return NextResponse.json({ error: 'conflict', note }, { status: 409 });
      } catch (readError) {
        if (apiErrorStatus(readError) === 404) {
          return NextResponse.json({ error: 'not found' }, { status: 404 });
        }
        return NextResponse.json({ error: 'upstream error' }, { status: 502 });
      }
    }
    if (status === 404) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (status === 400) return NextResponse.json({ error: 'invalid input' }, { status: 400 });
    return NextResponse.json({ error: 'upstream error' }, { status: 502 });
  }
}
