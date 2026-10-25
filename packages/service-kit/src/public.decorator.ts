import { SetMetadata, type CustomDecorator } from '@nestjs/common';

/**
 * Marks a route as unauthenticated so the global `AuthGuard` skips its JWT check.
 *
 * Health probes (and any future public surface) cannot log in, so they opt out of
 * the check explicitly rather than by route-path special-casing inside the guard.
 *
 * The metadata key is the contract: every service's `AuthGuard` reads
 * `IS_PUBLIC_KEY = 'auth:isPublic'` through `Reflector`, so a route decorated by
 * this package's `Public` is recognised without the service importing anything
 * from here. Keep the literal in sync with `src/auth/public.decorator.ts` in the
 * services — `IS_PUBLIC_KEY` is asserted equal in this package's tests.
 */
export const IS_PUBLIC_KEY = 'auth:isPublic';

export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_KEY, true);
