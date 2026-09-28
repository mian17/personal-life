import { NextResponse, type NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { createNoteWithTags } from '@/lib/note-compose';
import { apiErrorStatus, readFlushPayload } from '@/lib/flush-payload';

/**
 * The note create flush. Resolves the `#tag` names + attached ids through the
 * registry (create-or-get + detach exclusion, `SPEC-tags-extraction`) before
 * writing `tagIds`, so the inline tag behavior and the picker share one path.
 */
export async function POST(req: NextRequest) {
  const payload = await readFlushPayload(req);
  if (!payload.ok) {
    return NextResponse.json({ error: payload.error }, { status: 400 });
  }

  try {
    const note = await createNoteWithTags(payload.body, payload.tagIds, payload.inlineTagNames);
    return NextResponse.json(
      { ok: true, id: note.id, version: note.version, tagIds: note.tagIds },
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
