'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import type { CreateFeedbackInput, FeedbackStatus, FeedbackSubmitResult } from '@life/shared';
import { createFeedback, updateFeedbackStatus } from '@/lib/feedback-api';

/**
 * The submit seam every app's toolbar item calls (SPEC-feedback-ui). Any
 * non-OK upstream response becomes one message the dialog renders in its
 * `AlertBanner`; the client keeps the idempotency key for the retry.
 */
export async function submitFeedbackAction(
  input: CreateFeedbackInput,
): Promise<FeedbackSubmitResult> {
  try {
    const { id } = await createFeedback(input);
    revalidatePath('/feedback');
    return { ok: true, id };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: "Couldn't send feedback. Try again." };
  }
}

/**
 * The per-row status seam the inbox dropdown calls (SPEC-feedback-status). A
 * failed write becomes one message the row renders, the failure contract
 * `submitFeedbackAction` already sets.
 */
export async function setFeedbackStatusAction(
  id: string,
  status: FeedbackStatus,
): Promise<FeedbackSubmitResult> {
  try {
    await updateFeedbackStatus(id, status);
    revalidatePath('/feedback');
    return { ok: true, id };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, message: "Couldn't update status. Try again." };
  }
}