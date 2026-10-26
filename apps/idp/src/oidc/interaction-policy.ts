import { interactionPolicy } from 'oidc-provider';
import type { Grant, KoaContextWithOIDC } from 'oidc-provider';

const { base } = interactionPolicy;

/**
 * Interaction artifact lifetime: 15 minutes.
 *
 * A pending login only needs to outlive a human typing on the login form. The
 * app's own attempt cookie allows 10 minutes for the round-trip, so 15 minutes
 * is comfortably longer while still bounding how long an abandoned interaction
 * lingers in the adapter. Set explicitly (the library default is 60 minutes) so
 * the "you SHOULD change ttl.Interaction" NOTICE is gone and the bound is ours.
 */
export const INTERACTION_TTL_S = 15 * 60;

/**
 * Single-user IdP: there is no consent UI. The `consent` prompt is removed and
 * `loadExistingGrant` auto-grants every requested scope for the logged-in
 * account, so a valid session short-circuits straight to a code (no re-login, no
 * consent screen). `login` is retained so an unauthenticated request still
 * redirects to our login form.
 */
export function interactionPolicyPrompts(): interactionPolicy.DefaultPolicy {
  const policy = base();
  policy.remove('consent');
  return policy;
}

/**
 * Grants the requested OIDC scopes without user interaction, then persists the
 * grant through the adapter. Mirrors the library's documented no-consent
 * pattern; resource-indicator scopes are added when a resource is requested.
 */
export async function loadExistingGrant(ctx: KoaContextWithOIDC): Promise<Grant | undefined> {
  const { oidc } = ctx;
  if (!oidc.account || !oidc.client || !oidc.session) return undefined;

  const grantId =
    oidc.result?.consent?.grantId || oidc.session.grantIdFor(oidc.client.clientId);
  let grant = grantId ? await oidc.provider.Grant.find(grantId) : undefined;
  grant ??= new oidc.provider.Grant({
    accountId: oidc.account.accountId,
    clientId: oidc.client.clientId,
  });

  const oidcScopes = [...oidc.requestParamOIDCScopes];
  if (oidcScopes.length) grant.addOIDCScope(oidcScopes.join(' '));

  for (const [indicator, resourceServer] of Object.entries(oidc.resourceServers ?? {})) {
    const requested = [...oidc.requestParamScopes].filter((scope) =>
      resourceServer.scopes.has(scope),
    );
    if (requested.length) grant.addResourceScope(indicator, requested.join(' '));
  }

  await grant.save();
  return grant;
}
