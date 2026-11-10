/**
 * A module that declares both registry forms at once, which a loader must refuse:
 * exactly one of `registry` and `resources` says what a module registers
 * (SPEC-ops-all-services §1.1.2 E1).
 */
import type { ResourceRegistry } from '../../src/core/types.js';
import { sampleRegistry } from '../../src/fixtures/sample.js';

export const registry: ResourceRegistry = sampleRegistry;
export const resources: ResourceRegistry[] = [sampleRegistry];
