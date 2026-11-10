import { Module } from '@nestjs/common';
import { UsdaClient } from './usda.client.js';

/**
 * DI token for the USDA client factory.
 *
 * `UsdaClient` is meal-service's only USDA boundary (`SPEC-usda-source.md`):
 * built from `USDA_API_KEY`, with `USDA_API_BASE` optional and defaulted by the
 * client itself. The token's value is the client *factory* — a thunk, not a
 * client — exactly as `GEMINI_CLIENT_FACTORY` is for Gemini.
 *
 * That indirection is what keeps boot independent of USDA config: Nest binds
 * the function value at registration and runs no constructor, so a missing key
 * cannot stop the service from starting. A consumer builds its client on the
 * first lookup, where the client's own fail-closed env check (`usda.client.ts`)
 * reports a missing `USDA_API_KEY` as the deployment error it is.
 */
export const USDA_CLIENT_FACTORY = Symbol('USDA_CLIENT_FACTORY');

/**
 * The USDA FoodData Central adapter, standalone so the photo pipeline can
 * depend on it (Task 8 imports this module; it wires nothing here).
 *
 * The provider is the client *factory* (not a client): the thunk constructs the
 * client only when a consumer calls it on the first lookup, never at boot.
 *
 * There is **no cache provider in this module**, on purpose: `usda-source`
 * keeps no cache — the food catalog is the cache (`SPEC-usda-source.md` Cache
 * Rules) — so this module introduces no second Redis client and no fork of
 * `@life/cache`. That absence is the enforcement.
 */
@Module({
  providers: [{ provide: USDA_CLIENT_FACTORY, useValue: () => new UsdaClient(process.env) }],
  exports: [USDA_CLIENT_FACTORY],
})
export class UsdaModule {}
