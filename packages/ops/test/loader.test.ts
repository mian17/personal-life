/**
 * Loader suite (SPEC-ops-notes-service §9.2, §8.6; SPEC-ops-all-services §1.1.2 E1, E3):
 * `loadService` is the one place `LIFE_OPS_SERVICE` becomes a registry, and this suite
 * pins every reading of it. A comma-separated selector loads each entry in order, and
 * a bare name selects an in-package service module (`notes` → `src/services/notes`)
 * while anything path-like keeps going to the dynamic import of the value as written.
 * Base resolution is per call, so `apiBaseFor` is driven here without opening a socket.
 * No test contacts a real service.
 */
import { join } from 'node:path';
import { apiBaseFor, loadService } from '../src/cli/run';

/** The conformance suite's external module, loaded by absolute path exactly as the SDK suite loads it. */
const EXTERNAL_SERVICE_MODULE = 'test/support/service-module.ts';

/** A module file this suite loads as an external module, by the same absolute-path route. */
function externalModulePath(moduleName: string): string {
  return join(__dirname, '..', 'test', 'support', moduleName);
}

/** A selector of one bare service name and one support module, in that order. */
function commaSelector(serviceName: string, supportModule: string): string {
  return `${serviceName},${externalModulePath(`${supportModule}-service-module.ts`)}`;
}

describe('loadService', () => {
  describe('bare service name', () => {
    it('resolves the in-package notes module', async () => {
      const service = await loadService({ LIFE_OPS_SERVICE: 'notes' });

      expect(service.registry.name).toBe('notes');
      expect(service.apiBase).toBeUndefined();
    });

    it('trims surrounding whitespace before resolving', async () => {
      const service = await loadService({ LIFE_OPS_SERVICE: '  notes\n' });

      expect(service.registry.name).toBe('notes');
    });

    it('names the unknown service instead of importing the literal string', async () => {
      await expect(loadService({ LIFE_OPS_SERVICE: 'unknown-svc' })).rejects.toThrow(
        /unknown service unknown-svc/,
      );
    });

    it('lists all six services it does know when the name is unknown', async () => {
      await expect(loadService({ LIFE_OPS_SERVICE: 'unknown-svc' })).rejects.toThrow(
        /known services: notes, todo, meal, tags, focus, feedback/,
      );
    });
  });

  describe('comma-separated selector', () => {
    it('loads every entry, its resources in selector order', async () => {
      const service = await loadService({ LIFE_OPS_SERVICE: commaSelector('notes', 'multi-resource') });

      expect(service.resources?.map((resource) => resource.name)).toEqual([
        'notes',
        'todos',
        'lists',
      ]);
    });

    it('trims the whitespace around each entry', async () => {
      const service = await loadService({
        LIFE_OPS_SERVICE: ` notes ,  ${externalModulePath('multi-resource-service-module.ts')} `,
      });

      expect(service.modules?.map((module) => module.entry)).toEqual([
        'notes',
        externalModulePath('multi-resource-service-module.ts'),
      ]);
    });

    it('fails on an empty entry rather than skipping it', async () => {
      await expect(loadService({ LIFE_OPS_SERVICE: 'notes,,notes' })).rejects.toThrow(
        'LIFE_OPS_SERVICE entry 2 is empty; name a service or module for every entry',
      );
    });

    it('names an unknown entry and still lists every known service', async () => {
      await expect(loadService({ LIFE_OPS_SERVICE: 'notes,unknown-svc' })).rejects.toThrow(
        /unknown service unknown-svc; known services: notes, todo, meal, tags, focus, feedback/,
      );
    });

    it('rejects two entries registering one tool name, naming both', async () => {
      await expect(loadService({ LIFE_OPS_SERVICE: 'notes,notes' })).rejects.toThrow(
        /resources notes \(\/api\/notes\) and notes \(\/api\/notes\) both register tool name/,
      );
    });
  });

  describe('missing selector', () => {
    it.each([{}, { LIFE_OPS_SERVICE: '' }, { LIFE_OPS_SERVICE: '   ' }])(
      'rejects %p for want of a selector',
      async (env) => {
        await expect(loadService(env)).rejects.toThrow(
          'LIFE_OPS_SERVICE is not set; point it at a registry module',
        );
      },
    );
  });

  describe('multi-resource module', () => {
    it('loads every resource, its first one as the module registry', async () => {
      const service = await loadService({
        LIFE_OPS_SERVICE: externalModulePath('multi-resource-service-module.ts'),
      });

      expect(service.resources?.map((resource) => resource.name)).toEqual(['todos', 'lists']);
      expect(service.registry.name).toBe('todos');
    });

    it('leaves each resource its own base path', async () => {
      const service = await loadService({
        LIFE_OPS_SERVICE: externalModulePath('multi-resource-service-module.ts'),
      });

      expect(service.resources?.map((resource) => resource.basePath)).toEqual([
        '/api/todos',
        '/api/lists',
      ]);
    });

    it('loads a single-resource module, still reaching it through registry', async () => {
      const service = await loadService({ LIFE_OPS_SERVICE: 'notes' });

      expect(service.registry.name).toBe('notes');
      expect(service.resources).toBeUndefined();
    });
  });

  describe('declared registry form', () => {
    it('rejects a module declaring both registry and resources', async () => {
      await expect(
        loadService({ LIFE_OPS_SERVICE: externalModulePath('both-forms-service-module.ts') }),
      ).rejects.toThrow('exports both registry and resources');
    });

    it('rejects a module declaring an empty resource list', async () => {
      await expect(
        loadService({ LIFE_OPS_SERVICE: externalModulePath('empty-resources-service-module.ts') }),
      ).rejects.toThrow('exports no registry');
    });

    it('rejects two resources exposing one tool name, naming both', async () => {
      await expect(
        loadService({ LIFE_OPS_SERVICE: externalModulePath('colliding-resource-service-module.ts') }),
      ).rejects.toThrow(
        'resources todos (/api/todos) and todos (/api/archived-todos) both register tool name todos_get',
      );
    });
  });

  describe('per-call base resolution', () => {
    it('takes the shared base for a lone service, as a single-valued selector always did', async () => {
      const service = await loadService({ LIFE_OPS_SERVICE: 'notes' });
      const env = { LIFE_OPS_API_BASE: 'http://notes.test' };

      expect(apiBaseFor({ service, registry: service.registry, env })).toBe('http://notes.test');
    });

    it('fails naming the shared variable when a lone service has none', async () => {
      const service = await loadService({ LIFE_OPS_SERVICE: 'notes' });

      expect(() => apiBaseFor({ service, registry: service.registry, env: {} })).toThrow(
        'LIFE_OPS_API_BASE is not set; point it at the service API base',
      );
    });

    it('prefers the per-service variable over the shared one', async () => {
      const service = await loadService({ LIFE_OPS_SERVICE: commaSelector('notes', 'multi-resource') });
      const env = {
        LIFE_OPS_API_BASE_NOTES: 'http://notes.test',
        LIFE_OPS_API_BASE: 'http://shared.test',
      };

      expect(apiBaseFor({ service, registry: service.registry, env })).toBe('http://notes.test');
    });

    it('resolves each service to its own variable, one call at a time', async () => {
      const service = await loadService({ LIFE_OPS_SERVICE: commaSelector('notes', 'multi-resource') });
      const env = { LIFE_OPS_API_BASE_NOTES: 'http://notes.test' };
      const [notesResource, todosResource] = service.resources ?? [];

      expect(apiBaseFor({ service, registry: notesResource, env })).toBe('http://notes.test');
      expect(() => apiBaseFor({ service, registry: todosResource, env })).toThrow(
        'LIFE_OPS_SERVICE entry',
      );
    });

    it('never falls back to the shared base when several services load', async () => {
      const service = await loadService({ LIFE_OPS_SERVICE: commaSelector('notes', 'multi-resource') });
      const env = { LIFE_OPS_API_BASE: 'http://shared.test' };

      expect(() => apiBaseFor({ service, registry: service.registry, env })).toThrow(
        'LIFE_OPS_API_BASE_NOTES is not set; point it at the notes service API base',
      );
    });
  });

  describe('path-like value', () => {
    it('loads an absolute module that exports a bare registry', async () => {
      const service = await loadService({ LIFE_OPS_SERVICE: join(__dirname, '..', EXTERNAL_SERVICE_MODULE) });

      expect(service.registry.name).toBe('sample');
    });

    it('leaves a relative value to the dynamic import rather than the bare-name resolver', async () => {
      const specifier = './render';

      await expect(loadService({ LIFE_OPS_SERVICE: specifier })).rejects.toThrow(
        `LIFE_OPS_SERVICE module ${specifier} exports no service registry`,
      );
    });
  });
});
