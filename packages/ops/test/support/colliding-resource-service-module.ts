/**
 * A multi-resource module whose two resources claim the same name, so the loader
 * has to refuse the union on the tool name both would expose
 * (SPEC-ops-all-services §1.1.2 E1).
 */
import type { ResourceRegistry } from '../../src/core/types';

export const resources: ResourceRegistry[] = [
  { name: 'todos', basePath: '/api/todos', ops: [{ kind: 'get', fields: {} }] },
  { name: 'todos', basePath: '/api/archived-todos', ops: [{ kind: 'get', fields: {} }] },
];
