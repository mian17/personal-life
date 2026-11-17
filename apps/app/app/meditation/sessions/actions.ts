'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { deleteSitting } from '@/lib/meditation-api';

/**
 * The one write the sitting screens own (`SPEC-meditation-app` §10.1): stamp the delete on one
 * sitting, then land back on the log.
 *
 * The stamp is the service's, and the service answers `ok` only for a live sitting it owns — a
 * second delete finds nothing and says so, and nothing here retries it. Every read that counted
 * the sitting is rebuilt afterwards: the log, the detail page (now a 404), and the idle screen's
 * day progress all move.
 */
export async function deleteSittingAction(sittingId: string): Promise<void> {
  await deleteSitting(sittingId);
  revalidateMeditation();
  redirect('/meditation/sessions');
}

/** Every surface a stamped sitting leaves: the log, its own detail page, and the idle day read. */
function revalidateMeditation(): void {
  revalidatePath('/meditation/sessions');
  revalidatePath('/meditation/sessions/[id]', 'page');
  revalidatePath('/meditation');
}
