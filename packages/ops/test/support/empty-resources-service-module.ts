/**
 * A module whose `resources` list is empty: the declaration names no resource, so
 * the loader refuses it rather than loading a module with no registry
 * (SPEC-ops-all-services §1.1.2 E1).
 */
import type { ResourceRegistry } from '../../src/core/types.js';

export const resources: ResourceRegistry[] = [];
