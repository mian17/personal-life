/**
 * Dev-environment guard: every variable `@life/ops` reads must be either generated
 * by `scripts/setup-dev-env.sh` or a documented override with a code default, so
 * `npm run dev:build` alone leaves no export for the user to type.
 *
 * The scan is source-derived, not list-derived: a new `env.SOMETHING` read anywhere
 * under `src/` fails this suite until someone files it here and, if it has no
 * default, adds it to the generator template.
 *
 * ponytail: the scan only sees literal `env.KEY` / `env['KEY']` reads. A computed
 * key (`env[name]`) is invisible to it and falls back to the hand-lists below;
 * widen the scan if ops ever reads env through a helper.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const packageDirectory = resolve(__dirname, '..');
const sourceDirectory = join(packageDirectory, 'src');
const generatorPath = resolve(packageDirectory, '..', '..', 'scripts', 'setup-dev-env.sh');

/** Variables the dev stack cannot start the ops tooling without; the generator template owns them. */
const GENERATED_KEYS = [
  'IDP_ISSUER',
  'LIFE_OPS_SERVICE',
  'LIFE_OPS_API_BASE',
  'LIFE_OPS_CLIENT_ID',
  'LIFE_OPS_RESOURCE',
];

/** Variables with an in-code default or a platform meaning; deliberately absent from the generator. */
const DEFAULTED_KEYS = [
  'LIFE_OPS_CREDENTIALS_PATH',
  'LIFE_OPS_DEADLINE_MS',
  'LIFE_OPS_REFRESH_SKEW_MS',
  'XDG_CONFIG_HOME',
];

const ENV_READ = /(?:\bprocess\.)?\benv\.([A-Z][A-Z0-9_]*)\b|(?:\bprocess\.)?\benv\[['"]([A-Z][A-Z0-9_]*)['"]\]/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => join(directory, entry));
}

/** Every literal environment key the package's own source reads. */
function readKeys(): string[] {
  const found = new Set<string>();
  for (const file of sourceFiles(sourceDirectory)) {
    for (const match of readFileSync(file, 'utf8').matchAll(ENV_READ)) {
      found.add(match[1] ?? match[2]);
    }
  }
  return [...found].sort();
}

/** The generator defines a key only at line start, the same test its own append step uses. */
function generatorDefines(key: string): boolean {
  return new RegExp(`^${key}=`, 'm').test(readFileSync(generatorPath, 'utf8'));
}

describe('the dev env generator covers what @life/ops reads', () => {
  it('classifies every environment variable the source reads', () => {
    const classified = [...GENERATED_KEYS, ...DEFAULTED_KEYS].sort();
    const unclassified = readKeys().filter((key) => !classified.includes(key));
    if (unclassified.length > 0) {
      throw new Error(
        `unclassified env variable(s): ${unclassified.join(', ')} — add each to the template in ` +
          'scripts/setup-dev-env.sh and to GENERATED_KEYS, or to DEFAULTED_KEYS when the code defaults it',
      );
    }
    expect(readKeys()).toEqual(classified);
  });

  it('defines each generated variable in scripts/setup-dev-env.sh', () => {
    expect(GENERATED_KEYS.filter((key) => !generatorDefines(key))).toEqual([]);
  });
});
