import { Injectable } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { Provider } from 'oidc-provider';
import { SigningKeyService } from '../crypto/signing-key.service';
import { OidcAdapterService } from './adapter/oidc-adapter.service';
import { ACCESS_TOKEN_TTL_S, DEFAULT_RESOURCE, resourceServerPolicy } from './access-token.policy';
import { staticClients } from './clients';
import { interactionPolicyPrompts, loadExistingGrant } from './interaction-policy';

/** Issuer identifier; production must be browser-reachable (Tasks 7/8 design point). */
export function resolveIssuer(): string {
  return process.env.IDP_ISSUER ?? 'http://127.0.0.1:3003';
}

/**
 * oidc-provider route names this service mounts. Names that map to a disabled
 * feature are dropped by `handledPaths()`; a test asserts the resolved paths
 * match `provider.pathFor()` so the static fast-path gate cannot drift from the
 * library's route table (Configuration reference, "routes").
 */
export const OIDC_ROUTE_NAMES = [
  'authorization',
  'token',
  'introspection',
  'revocation',
  'jwks',
  'userinfo',
  'end_session',
  'pushed_authorization_request',
  'registration',
  'device_authorization',
  'code_verification',
  'challenge',
  'backchannel_authentication',
] as const;

export type OidcRouteName = (typeof OIDC_ROUTE_NAMES)[number];

/** Fast-path route check that never builds the provider (and thus never the keystore). */
const STATIC_OIDC_PATHS = [
  '/.well-known',
  '/auth',
  '/token',
  '/token/introspection',
  '/token/revocation',
  '/jwks',
  '/me',
  '/session/end',
  '/request',
  '/reg',
  '/device/auth',
  '/device',
  '/challenge',
  '/backchannel',
] as const;

export function isProviderPath(path: string): boolean {
  return STATIC_OIDC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Builds and owns the oidc-provider instance. Construction is lazy so traffic
 * that never reaches the protocol surface (health, login) never creates keys.
 */
@Injectable()
export class OidcService {
  private instance?: Provider;
  private resolved?: string[];
  private gate?: (req: Request, res: Response, next: NextFunction) => void;

  constructor(
    private readonly keys: SigningKeyService,
    private readonly adapter: OidcAdapterService,
  ) {}

  provider(): Provider {
    if (!this.instance) {
      this.instance = new Provider(resolveIssuer(), {
        jwks: this.keys.jwks(),
        clients: staticClients(),
        // Durable state (grants, codes, access tokens, interactions, sessions) in idp.db.
        adapter: this.adapter.factory(),
        // Code-only clients with PKCE S256 required (RFC 7636 / RFC 9700).
        responseTypes: ['code'],
        scopes: ['openid'],
        pkce: { required: () => true },
        // Access-token policy: JWT format, 10-minute TTL, audience-scoped via RFC 8707.
        ttl: { AccessToken: ACCESS_TOKEN_TTL_S },
        interactions: {
          policy: [...interactionPolicyPrompts()],
          url: (_ctx, interaction) => `/interaction/${interaction.uid}`,
        },
        // Resolve the account id (our User.id) to claims for the id_token/userinfo.
        findAccount: (_ctx, id) => ({
          accountId: id,
          claims: async () => ({ sub: id }),
        }),
        loadExistingGrant,
        features: {
          // The library's dev views accept any credentials and MUST stay off; we
          // wire the Task 3 login as the interaction handler instead.
          devInteractions: { enabled: false },
          resourceIndicators: {
            enabled: true,
            // Tokens are always JWT: when a client omits `resource`, resolve one.
            defaultResource: (_ctx, _client, oneOf) => oneOf?.[0] ?? DEFAULT_RESOURCE,
            useGrantedResource: () => true,
            getResourceServerInfo: (_ctx, resource) => resourceServerPolicy(resource),
          },
        },
      });
      // TLS terminates at Tailscale Serve in production; trust x-forwarded-*.
      this.instance.proxy = true;
    }
    return this.instance;
  }

  /** Provider endpoint paths for enabled features (used to verify the static gate). */
  handledPaths(): string[] {
    if (!this.resolved) {
      this.resolved = OIDC_ROUTE_NAMES.flatMap((name) => {
        try {
          return [this.provider().pathFor(name)];
        } catch {
          return [];
        }
      });
    }
    return this.resolved;
  }

  /**
   * Express middleware forwarding only provider-owned routes into
   * `provider.callback()`; everything else falls through to Nest. Mounted before
   * `app.init()` so it precedes Nest's body parsers — oidc-provider reads the raw
   * request body itself and warns when an upstream parser has already consumed it.
   * The provider (and keystore) is built only on the first OIDC request.
   */
  middleware(): (req: Request, res: Response, next: NextFunction) => void {
    return (req, res, next) => {
      if (!isProviderPath(req.path || '')) {
        next();
        return;
      }
      this.gate ??= this.buildGate();
      this.gate(req, res, next);
    };
  }

  private buildGate(): (req: Request, res: Response, next: NextFunction) => void {
    const callback = this.provider().callback();
    return (req, res, next) => {
      if (isProviderPath(req.path || '')) {
        callback(req, res);
        return;
      }
      next();
    };
  }
}
