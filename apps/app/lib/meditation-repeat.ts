/**
 * The bell repeat's two-way mapping (`SPEC-meditation-app` §1, plan Task [12]): a stored
 * count is the option that names it, and the endless choice is stored as `repeat: null`.
 *
 * Both directions live here so the screen cannot offer one option and save another.
 */

/** The option that stores `repeat: null` — ring until the sitting ends. */
export const UNTIL_SESSION_ENDS = 'until-end';

/** The stored repeat as the option that names it: a count, or the endless choice. */
export function repeatValue(repeat: number | null): string {
  return repeat === null ? UNTIL_SESSION_ENDS : String(repeat);
}

/** The endless choice is `null`; every counted option is its own number. */
export function repeatFrom(submitted: FormDataEntryValue | null): number | null {
  if (submitted === null || submitted === UNTIL_SESSION_ENDS) return null;
  return Number(submitted);
}
