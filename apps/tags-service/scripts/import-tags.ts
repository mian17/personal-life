import 'reflect-metadata';

/**
 * `import-tags` entry (`SPEC-tags-extraction` Migration script). Thin CLI over
 * the tested core in `src/tags/import.ts`; run via the workspace convention:
 *
 *   NOTE_MASTER_KEY=<key> TAGS_MASTER_KEY=<key> npm run import-tags -w @life/tags-service -- --dry-run
 *   NOTE_MASTER_KEY=<key> TAGS_MASTER_KEY=<key> npm run import-tags -w @life/tags-service
 *
 * Deploy Checklist (human-run) — verbatim from `docs/specs/SPEC-tags-extraction.md`:
 *
 * 1. Stop the stack (`docker compose down`).
 * 2. Backup the DB files that exist (note `life.db`; `tags.db` only after a first
 *    import). The script also takes its own verified backups before writing.
 * 3. `NOTE_MASTER_KEY=<key> TAGS_MASTER_KEY=<key> NOTE_DB_PATH=<life.db> TAGS_DB_PATH=<tags.db> npm run import-tags -w @life/tags-service -- --dry-run` → review counts. (DB-path vars optional — defaults resolve correctly from the repo root.)
 * 4. Same without `--dry-run` (apply; ends with the schema surgery).
 * 5. Boot (`docker compose up -d`) → verify tags render in `/notes`.
 * 6. Rollback = restore both backups + previous image (old code cannot read the new
 *    arrangement; dual-read does not apply here — M5).
 *
 * Hard line: the human runs this against the real DBs; agents and tests only ever
 * touch temp fixtures. Master keys are generated per environment
 * (`openssl rand -base64 32`) and never enter the repo.
 *
 * The core owns the ordering (backup → bootstrap → import/merge → surgery) and the
 * `import-tags [plan|apply]: …` report line.
 */

export { main } from '../src/tags/import.js';
