import { interactionPolicy } from 'oidc-provider';
import type { Grant, KoaContextWithOIDC } from 'oidc-provider';

const { base } = interactionPolicy;

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
  if (!grant) {
    grant = new oidc.provider.Grant({
      accountId: oidc.account.accountId,
      clientId: oidc.client.clientId,
    });
  }

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
