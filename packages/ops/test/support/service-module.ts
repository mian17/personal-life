/**
 * The conformance suite's service module (SPEC-ops-agent-contract §3.8): what
 * `LIFE_OPS_SERVICE` points at when the official SDK client spawns the stdio
 * entry. It exports the sample registry every other suite already drives, so the
 * conformance run proves no second contract, and takes its API base from
 * `LIFE_OPS_API_BASE`, so the spawned child speaks to the suite's stub only.
 */
import type { ResourceRegistry } from '../../src/core/types';
import { sampleRegistry } from '../../src/fixtures/sample';

export const registry: ResourceRegistry = sampleRegistry;
