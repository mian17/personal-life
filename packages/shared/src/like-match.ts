/**
 * Shared, service-agnostic `LIKE`-parity content matching
 * (`SPEC-service-kernel` "Shared primitives"). Moved verbatim from
 * `apps/note-service/src/notes/content-match.ts` under the AGENTS.md Contract 2
 * no-fork rule: every content-bearing service that can no longer match in SQL
 * (bodies are `@life/crypto` envelopes) runs this comparator over decrypted
 * values after a cache hit.
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
