/**
 * In-memory `LIKE`-parity content matching for `notes-at-rest` T4
 * (`SPEC-notes-at-rest` Search & Tag Filtering).
 *
 * Before T4 the service pushed content matching into SQL
 * (`note.body LIKE :q` with the bound pattern `` `%${q}%` ``). Once bodies are
 * stored as `@life/crypto` envelopes the DB can no longer see plaintext, so the
 * match moves in memory over the decrypted value. This module is the single
 * owner of the comparator; `SPEC-notes-at-rest` requires it to reproduce SQLite
 * `LIKE` semantics exactly, proven empirically by `test/content-match.test.ts`.
 *
 * Semantics (identical to SQLite's `LIKE`):
 * - `%` matches any sequence of characters, including an empty one.
 * - `_` matches exactly one character.
 * - Every other character is literal — so the user's typed `%`/`_` ARE active
 *   wildcards, exactly as they were when `q` was embedded raw into `%<q>%`.
 * - Matching is case-insensitive. SQLite folds **ASCII only** (`A–Z` ↔ `a–z`);
 *   this implementation lowercases with JS `toLowerCase()`, which folds Unicode
 *   more broadly (e.g. `İ` → `i` + combining dot, `K` KELVIN SIGN → `k`). That
 *   broader fold is the accepted, documented deviation from the spec.
 *
 * The `pattern` argument is a full `LIKE` pattern — the caller supplies the
 * surrounding `%` when it wants substring semantics (today's `%<q>%`). An empty
 * pattern therefore matches only empty text, as in SQLite; the "empty/undefined
 * `q` means no filtering" rule lives in the service, which skips the filter.
 */

/**
 * True when `text` matches the SQLite `LIKE` `pattern`, ASCII-case-insensitively.
 *
 * Implementation is the classic greedy wildcard matcher: O(n·m) worst case,
 * O(1) extra space (no per-row DP tables), operating on Unicode code points so
 * `_` consumes one visible character rather than one UTF-16 code unit.
 */
export function likeMatch(text: string, pattern: string): boolean {
  const input = Array.from(text.toLowerCase());
  const glob = Array.from(pattern.toLowerCase());

  let ti = 0;
  let pi = 0;
  // Index in `glob` of the most recent `%`, and the input position it had
  // consumed when first reached. On a mismatch we backtrack to just after that
  // `%` and let it absorb one more character.
  let star = -1;
  let starInput = 0;

  while (ti < input.length) {
    if (pi < glob.length && glob[pi] === '%') {
      // `%` is always a wildcard, even when the input character is itself `%`.
      star = pi;
      starInput = ti;
      pi += 1;
    } else if (pi < glob.length && (glob[pi] === '_' || glob[pi] === input[ti])) {
      ti += 1;
      pi += 1;
    } else if (star !== -1) {
      pi = star + 1;
      starInput += 1;
      ti = starInput;
    } else {
      return false;
    }
  }

  // Trailing `%`s may match the empty remainder.
  while (pi < glob.length && glob[pi] === '%') pi += 1;
  return pi === glob.length;
}
