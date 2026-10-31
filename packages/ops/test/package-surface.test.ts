/**
 * Package-surface suite (SPEC-ops-agent-contract §3.6, §10.4): the `exports` map
 * declares exactly the three public subpaths a consumer needs, points the two
 * executable ones at the paths `tsconfig.build.json` emits, and agrees with the
 * retained `main`/`types`/`bin` fields. The acceptance is the resolver: a
 * directory outside the package links it and `import.meta.resolve` settles
 * everything, so no `dist` is built, loaded, or probed.
 *
 * `import.meta` does not exist under ts-jest's CommonJS transform, so the
 * resolution runs in a child `node --input-type=module` process seeded with a
 * temp directory whose `node_modules/@life/ops` links this package — the layout
 * npm workspaces already produce.
 *
 * The last block names what a resource module needs to opt in to bulk
 * (SPEC-bulk-ops §2.9): the kinds, their `bulkSourceKind` lookup, and the cap
 * resolver, all reached through the entry point rather than a deep import.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assembleBulkEnvelope,
  BULK_KINDS,
  bulkItemInput,
  bulkSourceKind,
  DEFAULT_BULK_LIMIT,
  isBulkKind,
  resolveBulkLimit,
} from '../src/index';
import type { BulkEnvelope, BulkKind } from '../src/index';

const packageDirectory = realpathSync(resolve(__dirname, '..'));
const distDirectory = join(packageDirectory, 'dist');
const distExistedBeforeSuite = existsSync(distDirectory);

const PROGRAMMATIC_SURFACE = '@life/ops';
const STDIO_ENTRY = '@life/ops/mcp/server';
const MANIFEST = '@life/ops/package.json';
const INTERNAL_PATH = '@life/ops/dist/core/registry.js';
const CONSUMER_REQUESTS = [PROGRAMMATIC_SURFACE, STDIO_ENTRY, MANIFEST, INTERNAL_PATH];

const manifest = readJson(join(packageDirectory, 'package.json')) as PackageManifest;
const build = readJson(join(packageDirectory, 'tsconfig.build.json')) as BuildConfig;

interface PackageManifest {
  main?: string;
  types?: string;
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
  exports?: Record<string, string | { types?: string; default?: string }>;
}

interface BuildConfig {
  compilerOptions: { rootDir: string; outDir: string };
}

interface Resolution {
  name: string;
  resolved?: string;
  code?: string;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** The path `tsc -p tsconfig.build.json` writes for a source file, package-relative. */
function buildTargetFor(sourceFile: string): string {
  const { rootDir, outDir } = build.compilerOptions;
  const emitted = relative(rootDir, sourceFile).replace(/\.ts$/, '.js');
  return join(outDir, emitted);
}

/** A dist entry's request target without the leading `./`, or `undefined` when absent. */
function exportTarget(entry: string | { default?: string } | undefined): string | undefined {
  const request = typeof entry === 'string' ? entry : entry?.default;
  return request?.replace(/^\.\//, '');
}

function exportTypes(entry: string | { types?: string } | undefined): string | undefined {
  return typeof entry === 'string' ? undefined : entry?.types?.replace(/^\.\//, '');
}

/**
 * Resolve every request from a temp directory that links the package, in one
 * child process so the base URL sits outside the package's own tree.
 */
function resolveFromOutsidePackage(): Resolution[] {
  const consumerDirectory = mkdtempSync(join(tmpdir(), 'life-ops-consumer-'));
  try {
    linkPackageInto(consumerDirectory);
    return runResolverIn(consumerDirectory).map((resolution) => normalizeResolved(resolution, consumerDirectory));
  } finally {
    rmSync(consumerDirectory, { recursive: true, force: true });
  }
}

function linkPackageInto(consumerDirectory: string): void {
  const scopeDirectory = join(consumerDirectory, 'node_modules', '@life');
  mkdirSync(scopeDirectory, { recursive: true });
  symlinkSync(packageDirectory, join(scopeDirectory, 'ops'), 'junction');
}

/**
 * Node realpaths a resolved target only when that target exists. With no `dist`
 * built the answer keeps the consumer's symlink prefix, so map that prefix back
 * onto the package and the expectation is identical built or unbuilt.
 */
function normalizeResolved(resolution: Resolution, consumerDirectory: string): Resolution {
  if (resolution.resolved === undefined) return resolution;
  for (const base of new Set([consumerDirectory, realpathSync(consumerDirectory)])) {
    const linkPrefix = join(base, 'node_modules', '@life', 'ops');
    if (resolution.resolved.startsWith(linkPrefix)) {
      return { ...resolution, resolved: packageDirectory + resolution.resolved.slice(linkPrefix.length) };
    }
  }
  return resolution;
}

function runResolverIn(consumerDirectory: string): Resolution[] {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', resolverScript(CONSUMER_REQUESTS)], {
    cwd: consumerDirectory,
    encoding: 'utf8',
  });
  if (child.status !== 0) throw new Error(`resolver child failed: ${child.stderr}`);
  return (JSON.parse(child.stdout) as Resolution[]).map(asFilesystemPath);
}

/** `import.meta.resolve` answers a URL; the assertions compare paths. */
function asFilesystemPath(resolution: Resolution): Resolution {
  if (resolution.resolved === undefined) return resolution;
  return { ...resolution, resolved: fileURLToPath(resolution.resolved) };
}

function resolverScript(requests: string[]): string {
  return `
const requests = ${JSON.stringify(requests)};
const results = requests.map((name) => {
  try {
    return { name, resolved: import.meta.resolve(name) };
  } catch (error) {
    return { name, code: error.code ?? 'unknown' };
  }
});
console.log(JSON.stringify(results));
`;
}

function resolutionFor(resolutions: Resolution[], name: string): Resolution {
  const found = resolutions.find((resolution) => resolution.name === name);
  if (found === undefined) throw new Error(`no resolution recorded for ${name}`);
  return found;
}

describe('the declared package surface', () => {
  it('exports exactly the three public subpaths', () => {
    expect(Object.keys(manifest.exports ?? {}).sort()).toEqual(['.', './mcp/server', './package.json']);
  });

  it('sends the programmatic surface to the build output main and types name', () => {
    const entry = manifest.exports?.['.'];
    expect(exportTarget(entry)).toBe(manifest.main);
    expect(exportTypes(entry)).toBe(manifest.types);
  });

  it('sends the stdio entry to the path tsconfig.build.json emits for src/mcp/server.ts', () => {
    const entry = manifest.exports?.['./mcp/server'];
    const emittedServer = buildTargetFor(join('src', 'mcp', 'server.ts'));
    expect(exportTarget(entry)).toBe(emittedServer);
    expect(exportTypes(entry)).toBe(emittedServer.replace(/\.js$/, '.d.ts'));
  });

  it('carries a types condition on both dist entries and none elsewhere', () => {
    expect(exportTypes(manifest.exports?.['.'])).toBe('dist/index.d.ts');
    expect(exportTypes(manifest.exports?.['./mcp/server'])).toBe('dist/mcp/server.d.ts');
    expect(manifest.exports?.['./package.json']).toBe('./package.json');
  });

  it('keeps the binary and adds no runtime dependency', () => {
    expect(manifest.bin?.['life-ops']).toBe('dist/cli/run.js');
    expect(manifest.dependencies).toBeUndefined();
  });
});

describe('a consumer outside the package', () => {
  const resolutions = resolveFromOutsidePackage();

  it('resolves the programmatic surface to the built index', () => {
    const resolution = resolutionFor(resolutions, PROGRAMMATIC_SURFACE);
    expect(resolution.resolved).toBe(join(packageDirectory, 'dist', 'index.js'));
  });

  it('resolves the stdio entry to the built server', () => {
    const resolution = resolutionFor(resolutions, STDIO_ENTRY);
    expect(resolution.resolved).toBe(join(packageDirectory, 'dist', 'mcp', 'server.js'));
  });

  it('resolves the manifest read-only', () => {
    const resolution = resolutionFor(resolutions, MANIFEST);
    expect(resolution.resolved).toBe(join(packageDirectory, 'package.json'));
  });

  it('refuses a deep dist import', () => {
    const resolution = resolutionFor(resolutions, INTERNAL_PATH);
    expect(resolution.resolved).toBeUndefined();
    expect(resolution.code).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED');
  });

  it('builds no dist while resolving', () => {
    expect(existsSync(distDirectory)).toBe(distExistedBeforeSuite);
  });
});

describe('the entry point a resource module imports', () => {
  it('names the bulk vocabulary a `bulk: true` resource opts in through', () => {
    const bulkKinds: BulkKind[] = ['getMany', 'createMany', 'updateMany', 'deleteMany'];

    expect(BULK_KINDS).toEqual(bulkKinds);
    expect(bulkKinds.map(bulkSourceKind)).toEqual(['get', 'create', 'update', 'delete']);
  });

  it('recognizes a bulk kind and lets a single-row kind pass', () => {
    expect(BULK_KINDS.every(isBulkKind)).toBe(true);
    expect(isBulkKind('get')).toBe(false);
  });

  it('derives one item input: a bare id wrapped, a payload object passed through', () => {
    expect(bulkItemInput('getMany', 'journal-a')).toEqual({ id: 'journal-a' });
    expect(bulkItemInput('createMany', { title: 'Morning pages' })).toEqual({
      title: 'Morning pages',
    });
  });

  it('assembles the empty envelope of a batch that ran nothing', () => {
    const emptyEnvelope: BulkEnvelope = assembleBulkEnvelope([]);

    expect(emptyEnvelope).toEqual({ total: 0, succeeded: 0, failed: 0, results: [] });
  });

  it('resolves the bulk cap the environment asks for, and the default it falls back to', () => {
    expect(resolveBulkLimit({})).toBe(DEFAULT_BULK_LIMIT);
    expect(resolveBulkLimit({ LIFE_OPS_BULK_LIMIT: '25' })).toBe(25);
  });
});
