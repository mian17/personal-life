import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * The authenticated identity of a request: the IdP `sub` of the verified access
 * token (or the `dev-user` constant produced by the `NODE_ENV=development`
 * bypass). Set by `AuthGuard`; handlers read it via `@Principal()`. It is opaque
 * here — never parsed, never logged (`SPEC-meal-service` Code Style: `ownerSub`
 * always comes from `@Principal()`, never from a request body).
 */
export interface Principal {
  sub: string;
}

/** An Express request carrying the authenticated principal set by `AuthGuard`. */
export interface AuthenticatedRequest extends Request {
  principal: Principal;
}

/**
 * Param decorator exposing the request principal to handlers. `AuthGuard`
 * guarantees a principal exists before any handler runs; a request without one
 * never reaches the controller.
 */
export const Principal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.principal;
  },
);