import { createHash } from 'node:crypto';

/**
 * The one sentence a user is shown when they let a producer app write to their
 * todos from that app's own settings screen (`SPEC-todo-origin` assumption 12).
 *
 * It lives here, beside `OriginGrant`, because the grant row stores it verbatim:
 * the sentence in the database is the sentence the user agreed to, so it must be
 * the same text the screen displayed. `meal-service` stores the same value on its
 * own toggle and its settings page renders what the service reports, so there is
 * exactly one owner of this wording and a re-word is one edit.
 */
export const MEAL_TODO_DISCLOSURE =
  'Let meals create and tick three daily tasks in your todos — breakfast, lunch and ' +
  'dinner — and tick each one off as soon as you log something in that group.';

/**
 * The fingerprint stored beside the sentence: sha256 hex of the exact text.
 *
 * A consent row is evidence, and evidence has to survive a wording change: the
 * hash answers "is the sentence stored here still the sentence this build
 * shows?" without a second copy of the text to diff against.
 */
export function disclosureHash(disclosure: string): string {
  return createHash('sha256').update(disclosure).digest('hex');
}
