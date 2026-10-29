/**
 * Loader suite (SPEC-ops-notes-service §9.2, §8.6): `loadService` is the one place
 * `LIFE_OPS_SERVICE` becomes a registry, and this suite pins both readings of it.
 * A bare name selects an in-package service module (`notes` → `src/services/notes`);
 * anything path-like keeps going to the dynamic import of the value as written.
 * No test contacts a real service.
 */
import { join } from 'node:path';
import { loadService } from '../src/cli/run';

/** The conformance suite's external module, loaded by absolute path exactly as the SDK suite loads it. */
const EXTERNAL_SERVICE_MODULE = 'test/support/service-module.ts';

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
      await expect(loadService({ LIFE_OPS_SERVICE: 'tags' })).rejects.toThrow(/unknown service tags/);
    });

    it('lists the services it does know when the name is unknown', async () => {
      await expect(loadService({ LIFE_OPS_SERVICE: 'tags' })).rejects.toThrow(/known services: notes/);
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
