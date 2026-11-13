import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * The authenticated identity of a request: the IdP `sub` of the verified access
 * token (or the `dev-user` constant produced by the `NODE_ENV=development`
 * bypass), and the `client_id` of the OIDC client that token was issued to —
 * `null` when the token carries no such claim. Set by `AuthGuard`; handlers read
 * it via `@Principal()`. Claims are opaque here — never parsed, never logged.
 * `ownerSub` and any caller provenance always come from `@Principal()`, never
 * from a request body or a self-declared header.
 */
export interface Principal {
  sub: string;
  clientId: string | null;
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
