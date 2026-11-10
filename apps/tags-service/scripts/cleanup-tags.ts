/**
 * `cleanup-tags` entry (`SPEC-tags-service` `## Maintenance scripts`). Thin CLI
 * over the tested core in `src/tags/cleanup.ts`; run via the workspace
 * convention:
 *
 *   npm run cleanup-tags -w @life/tags-service -- --dry-run   # plan (read-only)
 *   npm run cleanup-tags -w @life/tags-service                # apply
 *
 * Runbook (human-run):
 *
 * 1. Stop the stack (`docker compose down`) — raw SQL bypasses the per-owner
 *    generation bump, so the cache's 60 s TTL backstop must be the only window.
 * 2. `--dry-run` first: review the summary line and the `orphan id=… owner=…`
 *    detail lines. Ids + owner only; names are never printed.
 * 3. Apply (default). The core takes a verified `VACUUM INTO` snapshot before
 *    the delete transaction; `TAGS_DB_PATH`/`NOTE_DB_PATH`/`TODO_DB_PATH`
 *    optionally override the repo-root-anchored defaults.
 * 4. Any of `tags.db`/`life.db`/`todo.db` missing → it fails closed and deletes
 *    nothing.
 *
 * Hard line: the human runs this against the real DBs; agents and tests only
 * ever touch temp fixtures. It never touches the cache layer.
 */

export { main } from '../src/tags/cleanup.js';
