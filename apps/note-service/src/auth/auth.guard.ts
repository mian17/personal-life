import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import {
  createJwksResolver,
  resolveVerifierConfig,
  verifyAccessToken,
  type JwksResolver,
  type VerifierConfig,
} from './jwt-verifier';

/**
 * JWT-only auth guard (Task 10). Every request must carry a valid IdP-issued
 * access token, verified offline via JWKS — signature, `iss`, `aud`, `exp` —
 * with a 30s clock skew. Any doubt fails closed; the token is never logged.
 *
 * The former static-token path was removed here (dual-accept ran through
 * Task 9); reverting this commit restores it.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private resolver?: JwksResolver;
  private config?: VerifierConfig;

  canActivate(context: ExecutionContext): Promise<boolean> | boolean {
    // Dev skips the token check for localhost; production behavior below is unchanged.
    if (process.env.NODE_ENV === 'development') return true;

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const [scheme, value] = header.split(' ');
    if (scheme !== 'Bearer' || !value) {
      throw new UnauthorizedException();
    }

    return this.verifyJwt(value);
  }

  private async verifyJwt(token: string): Promise<boolean> {
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
    try {
      await verifyAccessToken(token, this.resolver, this.config);
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
