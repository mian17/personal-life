import { Injectable } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { Provider } from 'oidc-provider';
import { SigningKeyService } from '../crypto/signing-key.service';
import { OidcAdapterService } from './adapter/oidc-adapter.service';
import { ACCESS_TOKEN_TTL_S, defaultResource, resourceServerPolicy } from './access-token.policy';
import { assertOidcConfig, staticClients } from './clients';
import { interactionPolicyPrompts, INTERACTION_TTL_S, loadExistingGrant } from './interaction-policy';
import {
  GRANT_TTL_S,
  REFRESH_TOKEN_TTL_S,
  ROTATE_REFRESH_TOKEN,
  SESSION_TTL_S,
  expiresWithSession,
  issueRefreshToken,
} from './refresh-token.policy';

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
  ) {
    // Fail fast at boot on production-critical config (e.g. a missing app client
    // secret). The provider itself stays lazily constructed so this does not
    // create signing keys for a process that never serves OIDC.
    assertOidcConfig();
  }

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
        // Refresh tokens: 30 days, rotated on every use, with reuse detection.
        // Session/Grant must outlive the refresh token, or grant validation would
        // cut the refresh chain short before its own TTL.
        ttl: {
          AccessToken: ACCESS_TOKEN_TTL_S,
          RefreshToken: REFRESH_TOKEN_TTL_S,
          Session: SESSION_TTL_S,
          Grant: GRANT_TTL_S,
          Interaction: INTERACTION_TTL_S,
        },
        rotateRefreshToken: ROTATE_REFRESH_TOKEN,
        issueRefreshToken,
        expiresWithSession,
        interactions: {
          policy: [...interactionPolicyPrompts()],
          url: (_ctx, interaction) => `/interaction/${interaction.uid}`,
        },
        // Resolve the account id (our User.id) to claims for the id_token/userinfo.
        findAccount: (_ctx, id) => ({
          accountId: id,
          claims: () => Promise.resolve({ sub: id }),
        }),
        loadExistingGrant,
        features: {
          // The enable-only protocol surface (SPEC-idp "Tech Stack" + decision 6):
          // discovery, authorization code + PKCE, token, refresh rotation, JWKS.
          // Everything else is explicitly disabled so library defaults cannot
          // advertise or serve endpoints outside that set. `resourceIndicators`
          // stays on because the audience-scoped access tokens (RFC 8707) depend
          // on it.
          //
          // The library's defaults leave `devInteractions`, `dPoP`,
          // `rpInitiatedLogout`, `pushedAuthorizationRequests`, and `userinfo`
          // enabled; RP-initiated logout (`end_session`) is a FORBIDDEN item and
          // is deferred to the multi-RP chapter (decision 6). Every flag below is
          // disabled explicitly, never left to the default.
          devInteractions: { enabled: false },
          resourceIndicators: {
            enabled: true,
            // Tokens are always JWT: when a client omits `resource`, resolve one.
            defaultResource: (_ctx, _client, oneOf) => oneOf?.[0] ?? defaultResource(),
            useGrantedResource: () => true,
            getResourceServerInfo: (_ctx, resource) => resourceServerPolicy(resource),
          },
          dPoP: { enabled: false },
          rpInitiatedLogout: { enabled: false },
          pushedAuthorizationRequests: { enabled: false },
          userinfo: { enabled: false },
          introspection: { enabled: false },
          revocation: { enabled: false },
          backchannelLogout: { enabled: false },
          deviceFlow: { enabled: false },
          registration: { enabled: false },
          registrationManagement: { enabled: false },
          requestObjects: { enabled: false },
          claimsParameter: { enabled: false },
          clientCredentials: { enabled: false },
          ciba: { enabled: false },
          encryption: { enabled: false },
          fapi: { enabled: false },
          jwtIntrospection: { enabled: false },
          jwtResponseModes: { enabled: false },
          jwtUserinfo: { enabled: false },
          mTLS: { enabled: false },
          attestClientAuth: { enabled: false },
          clientIdMetadataDocument: { enabled: false },
          richAuthorizationRequests: { enabled: false },
          rpMetadataChoices: { enabled: false },
          webMessageResponseMode: { enabled: false },
          externalSigningSupport: { enabled: false },
          openid4vci: { enabled: false },
        },
      });
      // TLS terminates at Tailscale Serve in production; trust x-forwarded-*.
      this.instance.proxy = true;
    }
    return this.instance;
  }

  /** Provider endpoint paths for enabled features (used to verify the static gate). */
  handledPaths(): string[] {
    this.resolved ??= OIDC_ROUTE_NAMES.flatMap((name) => {
      try {
        return [this.provider().pathFor(name)];
      } catch {
        return [];
      }
    });
    return this.resolved;
  }

  /** The provider's own session cookie name (`_session`), from the provider API — never hardcoded. */
  sessionCookieName(): string {
    return this.provider().cookieName('session');
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
