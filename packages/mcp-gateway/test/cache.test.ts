/**
 * `src/cache.ts` against Task 5's acceptance criteria (SPEC-mcp-gateway §9.6): per-upstream slices
 * in declared key order keyed by the config hash, total reads, per-key writes and drops, and an
 * upstream that was down contributing no slice rather than a sticky empty one.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dropToolSlice, readToolSlices, toolCacheFileFor, writeToolSlices } from '../src/cache.js';
import type { ToolCacheLocation } from '../src/cache.js';
import type { UpstreamSlice, UpstreamTool } from '../src/merge.js';

let directory: string;
let configPath: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'mcp-gateway-cache-'));
  configPath = join(directory, 'gateway.json');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function locationFor(configHash: string): ToolCacheLocation {
  return { path: toolCacheFileFor(configPath), configHash };
}

function sliceNamed(configKey: string, toolNames: readonly string[]): UpstreamSlice {
  return { configKey, tools: toolNames.map((name) => ({ name })) };
}

function keysOf(slices: readonly UpstreamSlice[]): string[] {
  return slices.map((slice) => slice.configKey);
}

function storedJson(location: ToolCacheLocation): unknown {
  return JSON.parse(readFileSync(location.path, 'utf8'));
}

describe('readToolSlices after a write', () => {
  it('returns the slices it wrote, in the declared key order', () => {
    const location = locationFor('hash-one');
    const written = [sliceNamed('notes', ['create', 'search']), sliceNamed('todos', ['add'])];

    writeToolSlices(location, written);

    expect(readToolSlices(location)).toEqual(written);
  });

  it('keeps every tool field it does not understand', () => {
    const published: UpstreamTool = {
      name: 'create',
      description: 'Create a note',
      inputSchema: { type: 'object' },
      defer_loading: true,
      _meta: { app: 'notes' },
      madeUpField: { kept: true },
    };

    const location = locationFor('hash-one');
    writeToolSlices(location, [{ configKey: 'notes', tools: [published] }]);

    expect(readToolSlices(location)[0].tools[0]).toEqual(published);
  });

  it('replaces a known key where it sits, keeping the declared order', () => {
    const location = locationFor('hash-one');
    writeToolSlices(location, [sliceNamed('notes', ['create']), sliceNamed('todos', ['add'])]);

    writeToolSlices(location, [sliceNamed('notes', ['create', 'remove'])]);

    expect(keysOf(readToolSlices(location))).toEqual(['notes', 'todos']);
    expect(readToolSlices(location)[0]).toEqual(sliceNamed('notes', ['create', 'remove']));
  });

  it('stores per-key slices and the config hash, never a merged name array', () => {
    const location = locationFor('hash-one');
    writeToolSlices(location, [sliceNamed('notes', ['create'])]);

    expect(storedJson(location)).toEqual({
      configHash: 'hash-one',
      slices: [{ configKey: 'notes', tools: [{ name: 'create' }] }],
    });
    expect(JSON.stringify(storedJson(location))).not.toContain('notes__create');
  });
});

describe('readToolSlices on a cache it cannot use', () => {
  it('reads a missing file as a miss', () => {
    expect(readToolSlices(locationFor('hash-one'))).toEqual([]);
  });

  it('reads another config hash as a miss', () => {
    writeToolSlices(locationFor('hash-one'), [sliceNamed('notes', ['create'])]);

    expect(readToolSlices(locationFor('hash-two'))).toEqual([]);
  });

  it('replaces the stale file instead of merging with it', () => {
    const stale = locationFor('hash-one');
    writeToolSlices(stale, [sliceNamed('notes', ['create'])]);

    const changed = locationFor('hash-two');
    writeToolSlices(changed, [sliceNamed('todos', ['add'])]);

    expect(readToolSlices(changed)).toEqual([sliceNamed('todos', ['add'])]);
    expect(keysOf(readToolSlices(stale))).toEqual([]);
  });

  it('reads malformed JSON as a miss without throwing', () => {
    const location = locationFor('hash-one');
    writeFileSync(location.path, '{ not json');

    expect(readToolSlices(location)).toEqual([]);
  });

  it('reads an unreadable file as a miss without throwing', () => {
    const location = locationFor('hash-one');
    mkdirSync(location.path);

    expect(readToolSlices(location)).toEqual([]);
  });

  it('reads a foreign file shape as a miss without throwing', () => {
    const location = locationFor('hash-one');
    writeFileSync(
      location.path,
      JSON.stringify({ configHash: 'hash-one', slices: [{ tools: [] }] }),
    );

    expect(readToolSlices(location)).toEqual([]);
  });

  it('still writes a usable cache after a malformed file', () => {
    const location = locationFor('hash-one');
    writeFileSync(location.path, 'garbage');

    writeToolSlices(location, [sliceNamed('notes', ['create'])]);

    expect(readToolSlices(location)).toEqual([sliceNamed('notes', ['create'])]);
  });
});

describe('dropToolSlice', () => {
  it('leaves the other slices in place, order otherwise intact', () => {
    const location = locationFor('hash-one');
    writeToolSlices(location, [
      sliceNamed('notes', ['create']),
      sliceNamed('todos', ['add']),
      sliceNamed('chat', ['send']),
    ]);

    dropToolSlice(location, 'todos');

    expect(readToolSlices(location)).toEqual([
      sliceNamed('notes', ['create']),
      sliceNamed('chat', ['send']),
    ]);
  });

  it('writes nothing when the key was never cached', () => {
    const location = locationFor('hash-one');
    writeToolSlices(location, [sliceNamed('notes', ['create'])]);

    dropToolSlice(location, 'todos');

    expect(keysOf(readToolSlices(location))).toEqual(['notes']);
  });
});

describe('an upstream that was down', () => {
  it('contributes no slice, and a later success fills it in without disturbing the others', () => {
    const location = locationFor('hash-one');
    writeToolSlices(location, [sliceNamed('notes', ['create'])]);

    expect(keysOf(readToolSlices(location))).toEqual(['notes']);

    writeToolSlices(location, [sliceNamed('todos', ['add'])]);

    expect(readToolSlices(location)).toEqual([
      sliceNamed('notes', ['create']),
      sliceNamed('todos', ['add']),
    ]);
  });
});
