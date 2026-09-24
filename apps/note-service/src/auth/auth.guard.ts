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
 * Dual-accept auth guard (Task 9): accepts EITHER a valid IdP-issued JWT
 * (verified offline via JWKS) OR the legacy static `API_TOKEN`, until Task 10
 * retires the static path.
 *
 * Credential disambiguation: a JWT is a compact JWS — three base64url segments
 * separated by dots. `API_TOKEN` is an opaque hex string with no dots. So a
 * bearer value is routed to the JWT verifier iff it is JWT-shaped; everything
 * else goes to the static comparison. This keeps the static path byte-compatible
 * (`Authorization: Bearer <API_TOKEN>` unchanged) while JWTs never touch it.
 */

/** JWT-shaped = three non-empty base64url-ish segments, exactly two dots. */
export function looksLikeJwt(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0 && /^[A-Za-z0-9_-]+$/.test(p));
}

@Injectable()
export class AuthGuard implements CanActivate {
  private resolver?: JwksResolver;
  private config?: VerifierConfig;

  canActivate(context: ExecutionContext): Promise<boolean> | boolean {
    // Dev skips the token checks for localhost; production behavior below is unchanged.
    if (process.env.NODE_ENV === 'development') return true;

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const [scheme, value] = header.split(' ');
    if (scheme !== 'Bearer' || !value) {
      throw new UnauthorizedException();
    }

    // A JWT-shaped credential goes through offline verification; anything else
    // is treated as the static token (dual-accept).
    if (looksLikeJwt(value)) {
      return this.verifyJwt(value);
    }

    return this.checkStaticToken(value);
  }

  private async verifyJwt(token: string): Promise<boolean> {
    if (!this.config) {
      try {
        this.config = resolveVerifierConfig();
      } catch {
        // JWT path not configured in this environment; reject JWTs (fail closed)
        // rather than falling through to the static comparison.
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

  private checkStaticToken(value: string): boolean {
    const token = process.env.API_TOKEN;
    if (!token) throw new UnauthorizedException('API_TOKEN not configured');
    if (value !== token) throw new UnauthorizedException();
    return true;
  }
}
