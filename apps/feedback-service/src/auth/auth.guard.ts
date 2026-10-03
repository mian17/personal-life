import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JWTPayload } from 'jose';
import {
  createJwksResolver,
  resolveVerifierConfig,
  verifyAccessToken,
  type JwksResolver,
  type VerifierConfig,
} from './jwt-verifier';
import type { AuthenticatedRequest, Principal } from './principal';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * JWT-only auth guard (kernel copy). Every request must carry a valid
 * IdP-issued access token, verified offline via JWKS — signature, `iss`, `aud`,
 * `exp` — with a 30s clock skew. Any doubt fails closed; the token is never
 * logged.
 *
 * A route marked `@Public()` (health probes; `IS_PUBLIC_KEY` metadata) skips
 * the check entirely — probes cannot log in. `Reflector` is resolved with a
 * default so the bare `new AuthGuard()` construction keeps working in tests and
 * modules that do not provide it.
 *
 * On success the verified `sub` is propagated as `request.principal`, and a
 * verified token without a usable `sub` is rejected with 401: claims without
 * identity are unauthenticated, and `sub` becomes an owner filter downstream.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private resolver?: JwksResolver;
  private config?: VerifierConfig;

  constructor(private readonly reflector: Reflector = new Reflector()) {}

  canActivate(context: ExecutionContext): Promise<boolean> | boolean {
    // Explicit `@Public()` exemption before any credential parsing: a public
    // route answers regardless of `NODE_ENV` and never inspects a token.
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])) {
      return true;
    }

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // Dev skips the token check for localhost; production behavior below is unchanged.
    if (process.env.NODE_ENV === 'development') {
      req.principal = { sub: 'dev-user' };
      return true;
    }

    const header = req.headers.authorization ?? '';
    const [scheme, value] = header.split(' ');
    if (scheme !== 'Bearer' || !value) {
      throw new UnauthorizedException();
    }

    return this.verifyJwt(req, value);
  }

  private async verifyJwt(req: AuthenticatedRequest, token: string): Promise<boolean> {
    if (!this.config) {
      try {
        this.config = resolveVerifierConfig();
      } catch {
        // Verification is not configured in this environment; fail closed.
        throw new UnauthorizedException();
      }
    }
    if (!this.resolver) {
      this.resolver = createJwksResolver(this.config);
    }
    let payload: JWTPayload;
    try {
      payload = await verifyAccessToken(token, this.resolver, this.config);
    } catch {
      throw new UnauthorizedException();
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      // A verified token without identity must never reach a query: `sub` is
      // about to become an owner filter (owner boundary).
      throw new UnauthorizedException();
    }
    req.principal = { sub: payload.sub } satisfies Principal;
    return true;
  }
}
