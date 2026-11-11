import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JWTPayload } from 'jose';
import {
  createJwksResolver,
  resolveVerifierConfig,
  verifyAccessToken,
  type JwksResolver,
  type VerifierConfig,
  type VerifierEnvNames,
} from './jwt-verifier.js';
import type { AuthenticatedRequest, Principal } from './principal.js';
import { IS_PUBLIC_KEY } from '../public.decorator.js';

/**
 * JWT-only auth guard shared by every service. Each request must carry a valid
 * IdP-issued access token, verified offline via JWKS — signature, `iss`, `aud`,
 * `exp` — with a 30s clock skew. Any doubt fails closed; the token is never
 * logged.
 *
 * A route marked `@Public()` (health probes) skips the check entirely — probes
 * cannot log in. `Reflector` is resolved with a default so the guard can be
 * constructed directly (`new AuthGuard(envNames)`) in `app.factory` and in tests
 * without Nest's injector.
 *
 * On success the verified `sub` and `client_id` are propagated as
 * `request.principal`, and a verified token without a usable `sub` is rejected
 * with 401: claims without identity are unauthenticated, and `sub` becomes an
 * owner filter downstream. `clientId` is always `null` when the token carries no
 * `client_id` claim.
 *
 * The `NODE_ENV=development` bypass only covers a request that presents no
 * credentials at all; a request that does present a bearer token is verified
 * normally in every environment, so a local token is never downgraded to the
 * shared `dev-user` and cannot borrow a caller's provenance.
 *
 * The two service-specific env var names arrive as `envNames`, so this one class
 * serves every service without a per-service copy of the verification logic.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private resolver?: JwksResolver;
  private config?: VerifierConfig;

  constructor(
    private readonly envNames: VerifierEnvNames,
    private readonly reflector: Reflector = new Reflector(),
  ) {}

  canActivate(context: ExecutionContext): Promise<boolean> | boolean {
    // Explicit `@Public()` exemption before any credential parsing: a public
    // route answers regardless of `NODE_ENV` and never inspects a token.
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(req);

    // Dev bypass is narrowed to anonymous localhost: a presented token always
    // verifies, so the shared `dev-user` principal never stands in for a caller.
    if (token === undefined && process.env.NODE_ENV === 'development') {
      req.principal = { sub: 'dev-user', clientId: null };
      return true;
    }
    if (token === undefined) {
      throw new UnauthorizedException();
    }

    return this.verifyJwt(req, token);
  }

  private async verifyJwt(req: AuthenticatedRequest, token: string): Promise<boolean> {
    if (!this.config) {
      try {
        this.config = resolveVerifierConfig(this.envNames);
      } catch {
        // Verification is not configured in this environment; fail closed.
        throw new UnauthorizedException();
      }
    }
    this.resolver ??= createJwksResolver(this.config);
    let payload: JWTPayload;
    try {
      payload = await verifyAccessToken(token, this.resolver, this.config);
    } catch {
      throw new UnauthorizedException();
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      // A verified token without identity must never reach a query: `sub` is
      // about to become an owner filter.
      throw new UnauthorizedException();
    }
    req.principal = { sub: payload.sub, clientId: clientIdOf(payload) } satisfies Principal;
    return true;
  }
}

/** The bearer token a request presents, or `undefined` when it presents none. */
function bearerToken(req: AuthenticatedRequest): string | undefined {
  const [scheme, value] = (req.headers.authorization ?? '').split(' ');
  return scheme === 'Bearer' && value ? value : undefined;
}

/** The verified `client_id` claim of a token, or `null` when it carries none. */
function clientIdOf(payload: JWTPayload): string | null {
  return typeof payload.client_id === 'string' ? payload.client_id : null;
}
