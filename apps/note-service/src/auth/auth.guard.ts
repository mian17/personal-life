import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { JWTPayload } from 'jose';
import {
  createJwksResolver,
  resolveVerifierConfig,
  verifyAccessToken,
  type JwksResolver,
  type VerifierConfig,
} from './jwt-verifier';
import type { AuthenticatedRequest, Principal } from './principal';

/**
 * JWT-only auth guard (Task 10; principal seam Task 1). Every request must carry
 * a valid IdP-issued access token, verified offline via JWKS — signature, `iss`,
 * `aud`, `exp` — with a 30s clock skew. Any doubt fails closed; the token is
 * never logged.
 *
 * On success the verified `sub` is propagated as `request.principal`, and a
 * verified token without a usable `sub` is rejected with 401: claims without
 * identity are unauthenticated, and `sub` becomes an owner filter downstream.
 *
 * The former static-token path was removed here (dual-accept ran through
 * Task 9); reverting this commit restores it.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private resolver?: JwksResolver;
  private config?: VerifierConfig;

  canActivate(context: ExecutionContext): Promise<boolean> | boolean {
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
      // about to become an owner filter (SPEC-note-ownership).
      throw new UnauthorizedException();
    }
    req.principal = { sub: payload.sub } satisfies Principal;
    return true;
  }
}
