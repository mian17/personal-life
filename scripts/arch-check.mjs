#!/usr/bin/env node
/**
 * Fail on an architecture violation that a static read can prove.
 *
 * Three rules are mechanical, so they are checked here instead of in a review:
 *
 *   RULE 3 — one database per service. Two services may not resolve to the same
 *            store (the same host bind path, the same SQLite file inside it, or
 *            the same Postgres database name), and a directory named
 *            `apps/<name>-service` may not ship with no store at all.
 *   RULE 4 — the engine is the designated one. SQLite everywhere except the
 *            explicitly allowlisted Postgres services.
 *   RULE 5 — no service reaches into another service's store: no import of
 *            another service's source, no literal path to another service's
 *            database file. Diff-scoped, so a pre-existing violation on the base
 *            ref never fails an unrelated branch.
 *
 * Rules 1 and 2 of AGENTS.md Contract 2 — every read flow goes through the cache's
 * `getThrough` loader, and the cache holds serialized rows (ciphertext), not
 * decrypted DTOs — need a reader, so they are not here, and there is no flag that
 * pretends otherwise. `.agents/skills/arch-boundary/SKILL.md` carries them.
 *
 * Rules 3 and 4 judge the resulting topology (compose.yaml plus every
 * `apps/<service>/src/app.module.ts` on disk), never the diff: a branch that moves
 * a service onto a shared file is a violation even when its own line looks
 * harmless.
 *
 * Exit 0 clean, 1 violations, 2 bad usage or a failed `git` call.
 *
 * Run: node scripts/arch-check.mjs [--worktree <path>] [--base <git-ref>] [--json]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The services the user named for Postgres. SQLite is this repo's default (the
 * `sqlite-default` rule), so adding an entry here is a human decision, not
 * something a diff may do on its own.
 */
export const POSTGRES_SERVICES = ['feedback-service'];

/**
 * The places `git` is installed. Fixed absolute paths, never a `PATH` search: a
 * writable directory in the caller's `PATH` could substitute the binary
 * (Sonar S4036), the same reason `scripts/sonar-autofix/receiver.mjs` resolves
 * its commands itself.
 */
const GIT_BINARIES = ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git'];

/** Bad invocation, or a `git` call the checker cannot answer honestly. */
class InputError extends Error {}

/** One finding, in the shape every rule and both output modes use. */
function finding(file, line, rule, message) {
  return { file, line, rule, message };
}

/** The lines of a text. */
function linesOf(text) {
  return text.split('\n');
}

/** The leading spaces of one raw line. */
function indentOf(line) {
  return line.length - line.trimStart().length;
}

/** Everything after the first `marker` on the line that carries it. */
function afterMarker(text, marker) {
  const line = linesOf(text).find((candidate) => candidate.includes(marker));
  if (line === undefined) return undefined;
  return line.slice(line.indexOf(marker) + marker.length);
}

/** 1-based line of the first match, or 1 when the marker is absent. */
function lineOf(text, marker) {
  const index = linesOf(text).findIndex((line) => line.includes(marker));
  return index === -1 ? 1 : index + 1;
}

/** Strips the quotes compose allows around a scalar. */
function unquote(value) {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if (quote !== "'" && quote !== '"') return trimmed;
  if (trimmed.length === 1 || !trimmed.endsWith(quote)) return trimmed;
  return trimmed.slice(1, -1);
}

/** Drops a trailing `# comment`: a `#` at line start or after whitespace. */
function stripComment(line) {
  const hash = line.indexOf('#');
  if (hash === -1) return line;
  if (hash === 0 || line[hash - 1].trim() === '') return line.slice(0, hash);
  return line;
}

/** `<key>: <value>` split at the first colon; a nested block leaves the value empty. */
function keyAndValue(body) {
  const colon = body.indexOf(':');
  if (colon === -1) return { key: '', value: '' };
  return { key: body.slice(0, colon).trim(), value: body.slice(colon + 1).trim() };
}

/** An empty compose service, filled in as its keys are read. */
function newService(name) {
  return { name, image: '', env: new Map(), hostMounts: [] };
}

/** One `KEY: value` entry of an `environment:` block. */
function writeEnvironment(service, body) {
  const { key, value } = keyAndValue(body);
  if (key) service.env.set(key, unquote(value));
}

/** The host side of a `- host:container` volume line, normalized. */
function addMount(service, spec) {
  const mount = normalize(unquote(spec.split(':')[0]));
  if (mount) service.hostMounts.push(mount);
}

/** A 6-space `- key: value` or `- host:container` line under the open key. */
function readNested(service, key, body) {
  if (key === 'environment')
    writeEnvironment(service, body.startsWith('- ') ? body.slice(2) : body);
  if (key === 'volumes' && body.startsWith('- ')) addMount(service, body.slice(2));
}

/** `image:` is the only 4-space key whose value the checker reads. */
function openKey(service, body) {
  const { key, value } = keyAndValue(body);
  if (key === 'image') service.image = unquote(value);
  return key;
}

/** Folds one line into the parse state; false ends the `services:` block. */
function applyComposeLine(state, entry) {
  if (entry.indent === 0) return false;
  if (entry.indent === 2) {
    state.service = newService(keyAndValue(entry.body).key);
    state.services.set(state.service.name, state.service);
  } else if (state.service && entry.indent === 4) {
    state.key = openKey(state.service, entry.body);
  } else if (state.service) {
    readNested(state.service, state.key, entry.body);
  }
  return true;
}

/**
 * The `services:` block as a map of service name to image, environment and host
 * bind mounts.
 *
 * A hand-rolled indentation walk rather than a YAML parser: the repo's scripts
 * carry zero runtime dependencies and only three keys are read. Ceiling: block
 * scalars and the list form of `environment:` are not understood — add a real
 * parser if compose grows either.
 */
function readCompose(path) {
  const entries = linesOf(readFileSync(path, 'utf8'))
    .map(stripComment)
    .map((line) => ({ indent: indentOf(line), body: line.trim() }))
    .filter((entry) => entry.body);
  const start = entries.findIndex((entry) => entry.indent === 0 && entry.body === 'services:');

  const state = { services: new Map(), service: null, key: '' };
  if (start === -1) return state.services;
  for (const entry of entries.slice(start + 1)) {
    if (!applyComposeLine(state, entry)) break;
  }
  return state.services;
}

/** The one finding a rule reports when compose.yaml is not there at all. */
function missingComposeFinding(worktree, rule) {
  if (existsSync(join(worktree, 'compose.yaml'))) return null;
  const message = `compose.yaml is missing under ${worktree}; the topology is unreadable`;
  return finding('compose.yaml', 1, rule, message);
}

/** Every `apps/*` directory with its module read, `text` null when it has none. */
function appModules(worktree) {
  const apps = join(worktree, 'apps');
  if (!existsSync(apps)) return [];

  return readdirSync(apps, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, file: join('apps', entry.name, 'src', 'app.module.ts') }))
    .map((app) => {
      const absolute = join(worktree, app.file);
      return { ...app, text: existsSync(absolute) ? readFileSync(absolute, 'utf8') : null };
    });
}

/** The TypeORM driver an `app.module.ts` names, or null when it names none. */
function declaredEngine(moduleText) {
  const value = afterMarker(moduleText, 'type:');
  const engine = value === undefined ? undefined : value.split("'")[1];
  return engine ?? null;
}

/** The SQLite filename an `app.module.ts` falls back to, or null when it has none. */
function declaredDatabase(moduleText) {
  const value = afterMarker(moduleText, 'database:');
  if (value === undefined) return null;
  return value.split("'").find((part) => part.endsWith('.db')) ?? null;
}

/** `focus-service` → `FOCUS`: the prefix of a per-service `FOCUS_DB_PATH` override. */
function envPrefix(serviceName) {
  return serviceName.replaceAll('-service', '').replaceAll('-', '_').toUpperCase();
}

/**
 * The `POSTGRES_DB` a Postgres app talks to: the postgres compose service whose
 * name carries the app's base name (`feedback-service` → `postgres-feedback`),
 * falling back to the only postgres service in the file.
 */
function postgresDatabaseName(serviceName, composeServices) {
  const base = serviceName.replaceAll('-service', '');
  const servers = [...composeServices.values()].filter((service) =>
    service.image.startsWith('postgres'),
  );
  const server = servers.find((candidate) => candidate.name.includes(base)) ?? servers[0];
  return server?.env.get('POSTGRES_DB') ?? null;
}

/** The store a Postgres app resolves to, or null when compose names no database. */
function postgresStore(app, composeServices) {
  const dbName = postgresDatabaseName(app.name, composeServices);
  if (!dbName) return null;
  return {
    name: app.name,
    file: app.file,
    line: lineOf(app.text, 'type:'),
    kind: 'postgres',
    dbName,
  };
}

/**
 * The store a SQLite app resolves to. `fileKey` is the database file as the host
 * sees it — note-service and meal-service both write a file *called* `life.db`,
 * but into their own `apps/<service>/data` bind mount, so the full path is the
 * identity and the basename alone is not.
 */
function sqliteStore(app, composeServices) {
  const service = composeServices.get(app.name);
  const override =
    service?.env.get('DB_PATH') ?? service?.env.get(`${envPrefix(app.name)}_DB_PATH`);
  const dbPath = override ?? declaredDatabase(app.text);
  if (!dbPath) return null;

  const bindKey = service?.hostMounts[0] ?? null;
  return {
    name: app.name,
    file: app.file,
    line: lineOf(app.text, 'database:'),
    kind: 'sqlite',
    bindKey,
    fileKey: bindKey ? join(bindKey, basename(dbPath)) : join('apps', app.name, dbPath),
  };
}

/** Every store an app resolves to, or null when it declares no database. */
function storeOf(app, composeServices) {
  if (declaredEngine(app.text) === 'postgres') return postgresStore(app, composeServices);
  return sqliteStore(app, composeServices);
}

/** Why two Postgres stores are one, or null when they are distinct. */
function sharedPostgres(left, right) {
  const bothServers = left.kind === 'postgres' && right.kind === 'postgres';
  if (!bothServers || left.dbName !== right.dbName) return null;
  return `the postgres database ${left.dbName}`;
}

/**
 * Why two stores are the same store, or null when they are distinct. A SQLite
 * file and a Postgres database that share a name are separate servers holding
 * separate data, so only like kinds collide.
 */
function sharedStore(left, right) {
  const servers = sharedPostgres(left, right);
  if (servers) return servers;
  if (left.kind === 'postgres' || right.kind === 'postgres') return null;
  if (left.bindKey && left.bindKey === right.bindKey) return `the host bind path ${left.bindKey}`;
  if (left.fileKey === right.fileKey) return `the database file ${left.fileKey}`;
  return null;
}

/** One finding per pair of services that resolve to the same store. */
function sharedStoreFindings(stores) {
  return stores.flatMap((left, index) =>
    stores.slice(index + 1).flatMap((right) => {
      const reason = sharedStore(left, right);
      if (!reason) return [];
      const message = `${left.name} and ${right.name} share ${reason}`;
      return [finding(right.file, right.line, 3, message)];
    }),
  );
}

/** RULE 3 findings for one app: a missing store, or nothing at all. */
function storeFindings(app, composeServices) {
  if (app.text === null) {
    if (!app.name.endsWith('-service')) return [];
    const message = `${app.name} declares no database: there is no src/app.module.ts`;
    return [finding(app.file, 1, 3, message)];
  }

  const store = storeOf(app, composeServices);
  if (store) return [];
  const message = `${app.name} declares no database; expected its own SQLite file or Postgres DB`;
  return [finding(app.file, lineOf(app.text, 'type:'), 3, message)];
}

/** RULE 3 — every service owns its store, and no two own the same one. */
export function checkDatabasePerService(worktree) {
  const missing = missingComposeFinding(worktree, 3);
  if (missing) return [missing];

  const composeServices = readCompose(join(worktree, 'compose.yaml'));
  const apps = appModules(worktree);
  const findings = apps.flatMap((app) => storeFindings(app, composeServices));
  const declared = apps.filter((app) => app.text !== null);
  const stores = declared.map((app) => storeOf(app, composeServices)).filter(Boolean);
  return [...findings, ...sharedStoreFindings(stores)];
}

/** What is wrong with one app's engine, or null when nothing is. */
function engineProblem(name, engine) {
  const allowlisted = POSTGRES_SERVICES.includes(name);
  if (engine === null) return `${name} declares no engine; expected 'better-sqlite3'`;
  if (engine !== 'better-sqlite3' && engine !== 'postgres') {
    return `${name} declares '${engine}'; expected 'better-sqlite3'`;
  }
  if (engine === 'postgres' && !allowlisted) {
    return `${name} declares 'postgres'; only ${POSTGRES_SERVICES.join(', ')} may`;
  }
  if (engine === 'better-sqlite3' && allowlisted) {
    return `${name} is allowlisted for postgres but declares 'better-sqlite3'`;
  }
  return null;
}

/** RULE 4 findings for one app. */
function engineFindings(app) {
  if (app.text === null) return [];
  const message = engineProblem(app.name, declaredEngine(app.text));
  if (message === null) return [];
  return [finding(app.file, lineOf(app.text, 'type:'), 4, message)];
}

/** RULE 4 — SQLite unless the user named Postgres for that service. */
export function checkEngineIsDesignated(worktree) {
  const missing = missingComposeFinding(worktree, 4);
  if (missing) return [missing];
  return appModules(worktree).flatMap((app) => engineFindings(app));
}

/** The path segments of one whitespace- or quote-delimited token of a line. */
function segmentsOf(token) {
  return token.split('/').filter(Boolean);
}

/** The tokens of a line, with quotes and tabs treated as separators. */
function tokensOf(line) {
  const spaced = line.replaceAll('"', ' ').replaceAll("'", ' ').replaceAll('\t', ' ');
  return spaced.split(' ').filter(Boolean);
}

/**
 * The service a segment run reaches into: a `..` climb into
 * `<service>/src/...`, or the owner of `<service>/data/...db` when no climb is
 * involved.
 */
function reachedService(segments) {
  const owner = segments.findIndex((segment) => segment.endsWith('-service'));
  if (owner === -1) return null;
  if (segments.includes('..')) return segments[owner];
  if (segments[owner + 1] !== 'data') return null;
  const namesDatabase = segments.slice(owner + 2).some((segment) => segment.endsWith('.db'));
  return namesDatabase ? segments[owner] : null;
}

/** The other service a line reaches into, or null when the line stays home. */
function crossedService(line) {
  for (const token of tokensOf(line)) {
    const reached = reachedService(segmentsOf(token));
    if (reached) return reached;
  }
  return null;
}

/** The service a repo-relative path belongs to, or null outside `apps/`. */
function serviceOfPath(file) {
  const [root, name] = file.split('/');
  return root === 'apps' ? name : null;
}

/**
 * RULE 5 findings in one file. A line the base ref already carries identically is
 * not this branch's doing, so only newly added lines are judged.
 */
export function findCrossServiceFindings({ file, content, baseContent }) {
  const importer = serviceOfPath(file);
  const baseLines = new Set(linesOf(baseContent));

  return linesOf(content).flatMap((line, index) => {
    if (baseLines.has(line)) return [];
    const target = crossedService(line);
    if (!target || target === importer) return [];
    const message = `${importer ?? file} reaches into ${target}: ${line.trim()}`;
    return [finding(file, index + 1, 5, message)];
  });
}

/** The `git` this machine has, or an `InputError` naming the paths it tried. */
function gitBinary() {
  const found = GIT_BINARIES.find((candidate) => existsSync(candidate));
  if (found) return found;
  throw new InputError(`git not found in ${GIT_BINARIES.join(', ')}`);
}

/** The base ref's copy of a file, or '' when the ref does not carry it. */
function baseContentOf(worktree, base, file) {
  try {
    return execFileSync(gitBinary(), ['-C', worktree, 'show', `${base}:${file}`], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

/** A git answer, or an `InputError` naming one line of stderr — never a stack. */
function git(worktree, args) {
  try {
    return execFileSync(gitBinary(), ['-C', worktree, ...args], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const detail = String(error.stderr ?? error.message)
      .trim()
      .split('\n')[0];
    throw new InputError(`git ${args.join(' ')} failed: ${detail}`);
  }
}

/** The lines of a git report, blanks dropped. */
function reportedLines(output) {
  return linesOf(output).filter((line) => line.trim());
}

/** True for a source file this rule judges, whether or not the branch deleted it. */
function isJudgeable(status, file) {
  const underSource = file.startsWith('apps/') || file.startsWith('packages/');
  return !status.startsWith('D') && file.endsWith('.ts') && underSource;
}

/** A path as git spelled it, without the quoting it adds for odd characters. */
function stripQuotes(path) {
  const trimmed = path.trim();
  const quoted = trimmed.startsWith('"') && trimmed.length > 1;
  return quoted ? trimmed.slice(1, -1) : trimmed;
}

/** The committed `.ts` files this branch adds or changes under `apps/` or `packages/`. */
function committedFiles(worktree, base) {
  const report = reportedLines(git(worktree, ['diff', '--name-status', `${base}...HEAD`]));
  return report.flatMap((line) => {
    const [status, ...paths] = line.split('\t');
    const file = paths[paths.length - 1];
    return isJudgeable(status, file) ? [file] : [];
  });
}

/** The uncommitted `.ts` files of the same shape, renames followed to their new path. */
function uncommittedFiles(worktree) {
  const report = reportedLines(git(worktree, ['status', '--porcelain']));
  return report.flatMap((line) => {
    const file = stripQuotes(line.slice(3).split(' -> ').pop());
    return isJudgeable(line.slice(0, 2), file) ? [file] : [];
  });
}

/** RULE 5 — no service reaches into another service's store. */
export function checkCrossServiceAccess(worktree, base) {
  const files = new Set([...committedFiles(worktree, base), ...uncommittedFiles(worktree)]);
  return [...files].flatMap((file) => {
    const absolute = join(worktree, file);
    const content = existsSync(absolute) ? readFileSync(absolute, 'utf8') : '';
    const baseContent = baseContentOf(worktree, base, file);
    return findCrossServiceFindings({ file, content, baseContent });
  });
}

/** Every finding across the three rules, in rule order. */
export function runChecks({ worktree, base }) {
  return [
    ...checkDatabasePerService(worktree),
    ...checkEngineIsDesignated(worktree),
    ...checkCrossServiceAccess(worktree, base),
  ];
}

/** `--worktree`, `--base`, `--json`; anything else is a usage error. */
export function parseArgs(argv) {
  const options = { worktree: process.cwd(), base: 'origin/dev', json: false };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      options.json = true;
    } else if (argument === '--worktree' || argument === '--base') {
      const value = argv[index + 1];
      if (value === undefined) throw new InputError(`${argument} needs a value`);
      options[argument.slice(2)] = value;
      index += 1;
    } else {
      throw new InputError(`unknown argument: ${argument}`);
    }
  }

  return options;
}

/** Human lines as `file:line — rule N — message`, or the JSON shape. */
function report(findings, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify({ findings, ok: findings.length === 0 }, null, 2)}\n`);
    return;
  }
  for (const { file, line, rule, message } of findings) {
    process.stdout.write(`${file}:${line} — rule ${rule} — ${message}\n`);
  }
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const worktree = resolve(options.worktree);
    if (!existsSync(worktree)) throw new InputError(`worktree does not exist: ${worktree}`);

    const findings = runChecks({ worktree, base: options.base });
    report(findings, options.json);
    return findings.length === 0 ? 0 : 1;
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = main();
}
