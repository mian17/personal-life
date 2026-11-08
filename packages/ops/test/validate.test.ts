/**
 * Required-value suite (SPEC.md §3): a flag given with no value arrives from the CLI
 * parser as an empty string, and an empty `id` must never compile into a request that
 * addresses the collection instead of one row. An optional string may still be empty.
 */
import { wireFor } from '../src/core/wire';
import { validateInput } from '../src/core/validate';
import { parseCallCommand } from '../src/cli/parse';
import { sampleRegistry } from '../src/fixtures/sample';
import { service as notesService } from '../src/services/notes';

describe('an empty required string', () => {
  it('is reported as a required issue naming the field', () => {
    const issues = validateInput(findKind(sampleRegistry, 'get'), { id: '' });

    expect(issues).toEqual([{ field: 'id', reason: 'required' }]);
  });

  it('is reported for every row-addressing kind', () => {
    for (const kind of ['get', 'update', 'delete'] as const) {
      const issues = validateInput(findKind(sampleRegistry, kind), { id: '' });

      expect(issues).toContainEqual({ field: 'id', reason: 'required' });
    }
  });

  it('is reported for restore too, through the notes registry', () => {
    const issues = validateInput(findKind(notesService.registry, 'restore'), { id: '' });

    expect(issues).toEqual([{ field: 'id', reason: 'required' }]);
  });

  it('still accepts the same id once it carries a value', () => {
    expect(validateInput(findKind(sampleRegistry, 'get'), { id: 'row-a' })).toEqual([]);
  });
});

describe('an empty optional string', () => {
  it('is accepted, so an optional field may legitimately be empty', () => {
    const issues = validateInput(findKind(notesService.registry, 'list'), { q: '' });

    expect(issues).toEqual([]);
  });
});

describe('a quoted empty --id from the CLI', () => {
  it('reaches the validator as an empty string and fails there, before any request', () => {
    const call = parseCallCommand(['notes', 'get', '--id', ''], notesService.registry);

    expect(validateInput(call.operation, call.input)).toEqual([{ field: 'id', reason: 'required' }]);
  });
});

describe('the wire path builder', () => {
  it('refuses an empty id that reached it, rather than addressing the collection', () => {
    expect(() => wireFor(sampleRegistry, 'get', { id: '' })).toThrow(
      'cannot address one row of id: empty value',
    );
  });

  it('still addresses one row for a real id', () => {
    expect(wireFor(sampleRegistry, 'get', { id: 'row-a' }).path).toBe('/samples/row-a');
  });
});

function findKind(
  registry: typeof sampleRegistry,
  kind: 'get' | 'list' | 'update' | 'delete' | 'restore',
) {
  const operation = registry.ops.find((candidate) => candidate.kind === kind);
  if (operation === undefined) throw new Error(`sample registry declares no ${kind} op`);
  return operation;
}
