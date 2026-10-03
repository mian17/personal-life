'use server';

import { revalidatePath } from 'next/cache';
import type { CreateFeedbackInput, FeedbackSubmitResult } from '@life/shared';
import { ApiError, createFeedback } from '@/lib/feedback-api';

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
    if (error instanceof ApiError) {
      return { ok: false, message: "Couldn't send feedback. Try again." };
    }
    throw error;
  }
}