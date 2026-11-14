#!/usr/bin/env node
/**
 * Fail on an architecture violation that a static read can prove.
 *
 * Four rules are mechanical, so they are checked here instead of in a review:
 *
 *   RULE 3 — one database per service. Two services may not resolve to the same
 *            store (the same mount holding the SQLite file, the same SQLite file
 *            inside it, or the same Postgres database name), and a directory
 *            named `apps/<name>-service` may not ship with no store at all.
 *   RULE 4 — the engine is the designated one. SQLite everywhere except the
 *            explicitly allowlisted Postgres services.
 *   RULE 5 — no service reaches into another service's store: no import of
 *            another service's source, no literal path to another service's
 *            database file. A comment naming such a path is prose, not access, so
 *            it is not reported. Diff-scoped, so a pre-existing violation on the
 *            base ref never fails an unrelated branch.
 *   RULE 6 — a variable a service cannot boot without is forwarded to its
 *            container: every read with no fallback that the service's own
 *            compose service does not pass through is a violation.
 *
 * Rules 1 and 2 of AGENTS.md Contract 2 — every read flow goes through the cache's
 * `getThrough` loader, and the cache holds serialized rows (ciphertext), not
 * decrypted DTOs — need a reader, so they are not here, and there is no flag that
 * pretends otherwise. `.agents/skills/arch-boundary/SKILL.md` carries them.
 *
 * Rules 3, 4 and 6 judge the resulting topology (compose.yaml plus the sources on
 * disk), never the diff: a branch that moves a service onto a shared file is a
 * violation even when its own line looks harmless, and a variable compose.yaml
 * never forwards is dead in the deployed artifact no matter which branch dropped
 * it.
 *
 * Exit 0 clean, 1 violations, 2 bad usage or a failed `git` call.
 *
 * Run: node scripts/arch-check.mjs [--worktree <path>] [--base <git-ref>] [--json]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, normalize, relative, resolve } from 'node:path';
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
  return { name, image: '', env: new Map(), mounts: [] };
}

/** One `KEY: value` entry of an `environment:` block. */
function writeEnvironment(service, body) {
  const { key, value } = keyAndValue(body);
  if (key) service.env.set(key, unquote(value));
}

/**
 * One `- host:container[:mode]` volume line. Both sides are kept: the host side
 * identifies the store, and the container side is how the store is found — a
 * service may mount a shared cache directory first and its own data directory
 * second, so "the first mount" is not the one holding the database.
 */
function addMount(service, spec) {
  const [host, container] = spec.split(':');
  const mount = { host: normalize(unquote(host)), container: normalize(unquote(container ?? '')) };
  if (mount.host) service.mounts.push(mount);
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

/**
 * The one finding a rule reports when compose.yaml is not a readable file. A
 * directory of that name is not a compose file either, and reading it would
 * throw a stack trace out of the process.
 */
function missingComposeFinding(worktree, rule) {
  const path = join(worktree, 'compose.yaml');
  if (existsSync(path) && statSync(path).isFile()) return null;
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

/** The mount whose container directory holds `dbPath`, or null when none does. */
function mountHolding(service, dbPath) {
  const mount = service?.mounts.find(
    (candidate) =>
      candidate.container &&
      (dbPath === candidate.container || dbPath.startsWith(`${candidate.container}/`)),
  );
  return mount ?? null;
}

/**
 * The store a SQLite app resolves to. `fileKey` is the database file as the host
 * sees it — note-service and meal-service both write a file *called* `life.db`,
 * but into their own `apps/<service>/data` mount, so the full path is the
 * identity and the basename alone is not.
 *
 * A path no mount holds (the module's own repo-relative default) stays under
 * `apps/<service>/`, which is per-service by construction and so can never be a
 * shared store: `bindKey` is null there rather than guessed.
 */
function sqliteStore(app, composeServices) {
  const service = composeServices.get(app.name);
  const override =
    service?.env.get('DB_PATH') ?? service?.env.get(`${envPrefix(app.name)}_DB_PATH`);
  const dbPath = override ?? declaredDatabase(app.text);
  if (!dbPath) return null;

  const bindKey = mountHolding(service, dbPath)?.host ?? null;
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
  // "Mount", not "host bind path": a named volume is as shared as a directory.
  if (left.bindKey && left.bindKey === right.bindKey) return `the mount ${left.bindKey}`;
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

  // A Postgres app behind no postgres server has declared its database and is
  // missing the server; saying "declares no database" would send the reader
  // looking at the wrong file. Rule 4 reports the engine separately, by design.
  const query = declaredEngine(app.text) === 'postgres' ? engineMissingServer : noDatabase;
  return [finding(app.file, lineOf(app.text, 'type:'), 3, query(app.name))];
}

/** Rule 3's message for a Postgres app compose gives no server to. */
function engineMissingServer(name) {
  return `${name} declares 'postgres' but compose.yaml names no postgres server for it`;
}

/** Rule 3's message for an app with neither an engine nor a database. */
function noDatabase(name) {
  return `${name} declares no database; expected its own SQLite file or Postgres DB`;
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
 * True for a line that is all comment. Prose cannot import or open anything, so a
 * doc comment naming another service's path — the usual shape of "this mirrors
 * `apps/tags-service/src/tags/import.ts`" — is not a reach.
 *
 * ponytail: a *trailing* comment after live code is still judged, because telling
 * it apart from a string literal needs a tokenizer; add one if that ever fires.
 */
function isComment(line) {
  const trimmed = line.trimStart();
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
}

/**
 * RULE 5 findings in one file. A line the base ref already carries identically is
 * not this branch's doing, so only newly added lines are judged.
 */
export function findCrossServiceFindings({ file, content, baseContent }) {
  const importer = serviceOfPath(file);
  const baseLines = new Set(linesOf(baseContent));

  return linesOf(content).flatMap((line, index) => {
    if (baseLines.has(line) || isComment(line)) return [];
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

/**
 * The uncommitted `.ts` files of the same shape, renames followed to their new
 * path. `-uall` is load-bearing: plain `status` reports a new directory as one
 * untracked entry, so every file inside it would escape the rule.
 */
function uncommittedFiles(worktree) {
  const report = reportedLines(git(worktree, ['status', '--porcelain', '-uall']));
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

/**
 * The variables a service reads without a fallback that compose.yaml is still right
 * not to forward, each for a reason a reviewer can check:
 *
 *   NODE_ENV                    — the image sets it (`ENV NODE_ENV=production` in
 *                                 every `apps/<name>/Dockerfile`), so compose
 *                                 forwarding it would be the redundancy, not the fix.
 *   APP_DEV_SKIP_ACCESS_GATE    — the dev-stack switch, documented in `apps/app/proxy.ts`
 *                                 as "Set ONLY on a dev command line …, never in a
 *                                 deployed service's environment". Forwarding it into a
 *                                 container would drop the Tailscale gate.
 *   OWNER_LOGIN                 — reaches the app container through its `env_file: .env`
 *                                 (first line of `.env.example`, and the deploy runbook's
 *                                 "two more reach containers through env_file"), so it is
 *                                 forwarded; only not through the `environment:` block this
 *                                 rule keys on. Adding it there would duplicate the source.
 */
export const NOT_FORWARDED_BY_DESIGN = ['NODE_ENV', 'APP_DEV_SKIP_ACCESS_GATE', 'OWNER_LOGIN'];

/** A `process.env` read as far as this rule can see it: a name and where it is. */
const DOT_READ = /process\.env\.([A-Za-z_$][\w$]*)/g;

/** A read whose name lives in a constant: `process.env[TODOS_API_URL_ENV]`. */
const BRACKET_READ = /process\.env\[([A-Za-z_$][\w$]*)\]/g;

/** `const NAME = 'VALUE'` — the only indirection a bracket read may resolve through. */
const NAMED_CONSTANT = /const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*'([A-Za-z0-9_]+)'/g;

/** A `??` or `||` anywhere after the read gives it an answer, so it is not hard. */
const FALLBACK = /\?\?|\|\|/;

/**
 * The directories inside an app that are not the deployed service: tests never run
 * in a container, host-side CLIs (`apps/<name>/scripts`) are never copied into an
 * image (the Dockerfile copies `dist` only), and `node_modules`/`dist` are build
 * output.
 */
const NOT_SHIPPED = ['node_modules', 'dist', 'test', 'scripts'];

/** Every `.ts`/`.tsx` file an app ships, or none when it has none. */
function sourceFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return NOT_SHIPPED.includes(entry.name) ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Every `apps/<name>` that ships sources of its own, with those sources. */
function appSources(worktree) {
  const apps = join(worktree, 'apps');
  if (!existsSync(apps)) return [];
  return readdirSync(apps, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, files: sourceFiles(join(apps, entry.name)) }))
    .filter((app) => app.files.length > 0);
}

/**
 * The sources of every workspace package. A service may import the constant a
 * bracket read uses — `TODOS_API_URL_ENV` comes from `@life/service-kit` — so the
 * name is resolved where it is declared, not guessed from the read site.
 */
function sharedSources(worktree) {
  const packages = join(worktree, 'packages');
  if (!existsSync(packages)) return [];
  return readdirSync(packages, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => sourceFiles(join(packages, entry.name, 'src')));
}

/** The string-valued constants declared in `files`, keyed by name. */
function namedConstants(files) {
  const constants = new Map();
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(NAMED_CONSTANT)) {
      constants.set(match[1], match[2]);
    }
  }
  return constants;
}

/** True when the text after a read is an `??`/`||` fallback, not a bare concatenation. */
function hasFallback(afterRead) {
  return FALLBACK.test(afterRead);
}

/**
 * The variables one line reads with no fallback. Two shapes, because the code has
 * two: `process.env.NAME`, and `process.env[CONST]` where `CONST` is a string
 * literal declared in the sources this run resolved. A constant this run cannot
 * resolve is left alone rather than guessed at.
 */
function hardReadNames(line, constants) {
  if (isComment(line)) return [];

  const dotReads = [...line.matchAll(DOT_READ)]
    .filter((match) => !hasFallback(line.slice(match.index + match[0].length)))
    .map((match) => match[1]);
  const bracketReads = [...line.matchAll(BRACKET_READ)]
    .filter((match) => !hasFallback(line.slice(match.index + match[0].length)))
    .map((match) => constants.get(match[1]))
    .filter(Boolean);

  return [...dotReads, ...bracketReads].filter((name) => !NOT_FORWARDED_BY_DESIGN.includes(name));
}

/** Rule 6's message: the service, the variable, and what compose owes it. */
function refuserMessage(serviceName, variable) {
  return `${serviceName} reads ${variable} with no fallback, but its compose service does not forward it`;
}

/**
 * RULE 6 findings for one service: one per variable it cannot run without and its
 * container never receives, reported at the first place it is read.
 */
function unforwardedFindings({ serviceName, files, constants, forwarded, worktree }) {
  const firstRead = new Map();

  for (const file of files) {
    linesOf(readFileSync(file, 'utf8')).forEach((line, index) => {
      for (const variable of hardReadNames(line, constants)) {
        if (forwarded.has(variable) || firstRead.has(variable)) continue;
        firstRead.set(variable, { file: relative(worktree, file), line: index + 1 });
      }
    });
  }

  return [...firstRead].map(([variable, site]) => {
    return finding(site.file, site.line, 6, refuserMessage(serviceName, variable));
  });
}

/**
 * RULE 6 — a variable a service cannot boot without is forwarded to its
 * container.
 *
 * Mechanical because both halves are text: the sources say which names the service
 * reads with no fallback, compose.yaml says which names its container is handed,
 * and either the name is a key in that service's `environment:` block or it is not.
 * No runtime, no judgement.
 *
 * The bug it exists for, 2026-11-14: `MEAL_TODOS_API_URL`, `FOCUS_TODOS_API_URL`
 * and `OIDC_PRODUCER_*` were read with no fallback, written into dev's env file,
 * and never forwarded to the containers — three features dead in a shipped release
 * while every check stayed green, because nothing in CI ever compared the code's
 * requirements with compose.yaml.
 *
 * Topology-scoped like rules 3 and 4, not diff-scoped: the subject is the deployed
 * artifact, so a variable compose.yaml never forwards is dead whichever branch
 * dropped it, and an unrelated PR should not be the one to report it.
 *
 * One gap, stated rather than papered over: the IdP composes one setting name at
 * runtime — `OIDC_PRODUCER_${name}_REDIRECT_URIS` in `apps/idp/src/oidc/clients.ts`
 * — and no static read can see that. This rule judges statically-named hard reads
 * only; dynamically-composed names and boot-time crashes are covered by the
 * compose-boot CI job (a separate change).
 */
export function checkEnvForwarding(worktree) {
  const missing = missingComposeFinding(worktree, 6);
  if (missing) return [missing];

  const composeServices = readCompose(join(worktree, 'compose.yaml'));
  const shared = namedConstants(sharedSources(worktree));

  return appSources(worktree).flatMap((app) => {
    // A service this compose file does not deploy has no container to forward
    // into; rule 3 is the one that reports an app shipping with no store.
    const service = composeServices.get(app.name);
    if (service === undefined) return [];

    const constants = new Map([...shared, ...namedConstants(app.files)]);
    return unforwardedFindings({
      serviceName: app.name,
      files: app.files,
      constants,
      forwarded: new Set(service.env.keys()),
      worktree,
    });
  });
}

/** Every finding across the four rules, in rule order. */
export function runChecks({ worktree, base }) {
  return [
    ...checkDatabasePerService(worktree),
    ...checkEngineIsDesignated(worktree),
    ...checkCrossServiceAccess(worktree, base),
    ...checkEnvForwarding(worktree),
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

/** The worktree to judge, refusing a path `git` could not be asked about. */
function worktreeOf(raw) {
  const worktree = resolve(raw);
  if (!existsSync(worktree)) throw new InputError(`worktree does not exist: ${worktree}`);
  if (!statSync(worktree).isDirectory()) {
    throw new InputError(`worktree is not a directory: ${worktree}`);
  }
  return worktree;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const worktree = worktreeOf(options.worktree);

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
