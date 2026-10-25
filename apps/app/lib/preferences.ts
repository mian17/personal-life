/**
 * App-owned preference barrel (`SPEC-app-kit-settings`). Server-side only: it
 * re-exports `readPref`, which imports `next/headers`. Client modules must import
 * the action through the `@life/app-kit/preference-action` subpath instead.
 */
export type AppPrefKey = 'matrix';
export { readPref, setPref } from '@life/app-kit';
