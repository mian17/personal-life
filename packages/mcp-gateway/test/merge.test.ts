/**
 * `src/merge.ts` against Task 4's acceptance criteria (SPEC-mcp-gateway §2, §9.8): one prefixing
 * pass renames and touches nothing else, order is deterministic, and both failures — a repeated
 * forwarded name and a name outside the spec's shape — arrive as `-32001` errors naming their
 * offender rather than as a rename or a dropped tool.
 */
import {
  IllegalToolName,
  MERGE_ERROR_CODE,
  MergeCollision,
  mergeToolTables,
} from '../src/merge.js';
import type { ForwardedTool, UpstreamSlice, UpstreamTool } from '../src/merge.js';

const LEGAL_MERGED_NAME = /^[A-Za-z0-9_.-]{1,128}$/;

const ECHO_TOOL: UpstreamTool = {
  name: 'echo',
  description: 'Echo the arguments back',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
  annotations: { readOnlyHint: true },
  defer_loading: true,
  tool_reference: { server: 'alpha', tool: 'echo' },
  _meta: { app: 'alpha' },
  madeUpField: { kept: true },
};

function sliceNamed(configKey: string, toolNames: readonly string[]): UpstreamSlice {
  return { configKey, tools: toolNames.map((name) => ({ name })) };
}

function namesOf(forwarded: readonly ForwardedTool[]): string[] {
  return forwarded.map((tool) => tool.name);
}

function mergeErrorFrom(merge: () => unknown): MergeCollision | IllegalToolName {
  try {
    merge();
  } catch (error) {
    if (error instanceof MergeCollision || error instanceof IllegalToolName) return error;
    throw error;
  }
  throw new Error('expected a merge failure, none was thrown');
}

describe('mergeToolTables', () => {
  it('names every tool after its config key and its own name', () => {
    const forwarded = mergeToolTables([
      sliceNamed('alpha', ['echo', 'fail']),
      sliceNamed('bravo', ['search']),
    ]);

    expect(namesOf(forwarded)).toEqual(['alpha__echo', 'alpha__fail', 'bravo__search']);
    for (const name of namesOf(forwarded)) expect(name).toMatch(LEGAL_MERGED_NAME);
  });

  it('keeps every field it does not understand, deep-equal', () => {
    const slice = { configKey: 'alpha', tools: [ECHO_TOOL] };

    const [forwarded] = mergeToolTables([slice]);

    expect(forwarded).toEqual({ ...ECHO_TOOL, name: 'alpha__echo' });
    expect(slice.tools[0].name).toBe('echo');
  });

  it('follows config declaration order, then each upstream own tools order', () => {
    const forwarded = mergeToolTables([
      sliceNamed('bravo', ['second', 'first']),
      sliceNamed('alpha', ['only']),
    ]);

    expect(namesOf(forwarded)).toEqual(['bravo__second', 'bravo__first', 'alpha__only']);
  });

  it('builds identical names in identical order from identical slices', () => {
    const slices = [sliceNamed('alpha', ['echo', 'fail']), sliceNamed('bravo', ['search'])];

    expect(namesOf(mergeToolTables(slices))).toEqual(namesOf(mergeToolTables(slices)));
  });

  it('prefixes once, even when the tool own name already carries a prefix', () => {
    const forwarded = mergeToolTables([sliceNamed('bravo', ['alpha__echo'])]);

    expect(namesOf(forwarded)).toEqual(['bravo__alpha__echo']);
  });

  it('refuses a name two upstreams both claim, naming both config keys', () => {
    const slices = [sliceNamed('a', ['b__c']), sliceNamed('a__b', ['c'])];

    const error = mergeErrorFrom(() => mergeToolTables(slices));

    expect(error).toBeInstanceOf(MergeCollision);
    expect(error.code).toBe(MERGE_ERROR_CODE);
    expect(error.message).toContain('"a__b__c"');
    expect(error.message).toContain('"a" and "a__b"');
  });

  it('refuses one upstream declaring a tool name twice', () => {
    const repeated = { configKey: 'bravo', tools: [{ name: 'shared' }, { name: 'shared' }] };

    const error = mergeErrorFrom(() => mergeToolTables([repeated]));

    expect(error).toBeInstanceOf(MergeCollision);
    expect(error.message).toContain('"bravo__shared"');
  });

  it('refuses a tool name that pushes the forwarded name past 128 characters', () => {
    const overlongName = 'x'.repeat(123);

    const error = mergeErrorFrom(() => mergeToolTables([sliceNamed('demo', [overlongName])]));

    expect(error).toBeInstanceOf(IllegalToolName);
    expect(error.code).toBe(MERGE_ERROR_CODE);
    expect(error.message).toContain(`"demo__${overlongName}"`);
    expect(error.message).toContain(`"${overlongName}"`);
    expect(error.message).toContain('"demo"');
  });

  it('allows a forwarded name of exactly 128 characters', () => {
    const longestLegalName = 'x'.repeat(122);

    const forwarded = mergeToolTables([sliceNamed('demo', [longestLegalName])]);

    expect(namesOf(forwarded)).toEqual([`demo__${longestLegalName}`]);
    expect(namesOf(forwarded)[0]).toHaveLength(128);
  });

  it('refuses a config key outside the name shape, naming the offender and its key', () => {
    const error = mergeErrorFrom(() => mergeToolTables([sliceNamed('bad key', ['echo'])]));

    expect(error).toBeInstanceOf(IllegalToolName);
    expect(error.message).toContain('"bad key__echo"');
    expect(error.message).toContain('"bad key"');
    expect(error.message).toContain('"echo"');
  });
});
