import { SetMetadata } from '@nestjs/common';
import type { CustomDecorator } from '@nestjs/common';

/**
 * Marks a route as unauthenticated so the global `AuthGuard` skips it.
 *
 * Health probes (and any future public surface) cannot log in, so they opt out
 * of the JWT check explicitly rather than by route-path special-casing inside
 * the guard. The metadata is read via a `Reflector` the guard resolves with a
 * default, so `new AuthGuard()` keeps working in tests and bare modules.
 */
export const IS_PUBLIC_KEY = 'auth:isPublic';

export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_KEY, true);