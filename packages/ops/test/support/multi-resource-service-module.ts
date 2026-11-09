/**
 * The multi-resource module form (SPEC-ops-all-services §1.1.2 E1): one module,
 * two resources, each addressing its own base path.
 */
import type { ResourceRegistry } from '../../src/core/types.js';

export const resources: ResourceRegistry[] = [
  { name: 'todos', basePath: '/api/todos', ops: [{ kind: 'get', fields: {} }] },
  { name: 'lists', basePath: '/api/lists', ops: [{ kind: 'list', fields: {} }] },
];
