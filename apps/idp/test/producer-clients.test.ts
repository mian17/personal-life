import type { ClientMetadata } from 'oidc-provider';
import { staticClients } from '../src/oidc/clients.js';

const PRODUCER_CLIENT_IDS = ['producer-a', 'producer-b'];

function registeredClient(clientId: string): ClientMetadata | undefined {
  return staticClients().find((client) => client.client_id === clientId);
}

/**
 * One client per producer, so a verified access token's `client_id` names the
 * producer and the hub's grant table can decide what that producer may write.
 * PKCE itself is enforced provider-wide (`pkce.required` in `OidcService`), not
 * per client, so these tests pin the code flow each client asks to use.
 */
describe('producer OIDC clients', () => {
  it('registers a client for each producer under its own id', () => {
    for (const clientId of PRODUCER_CLIENT_IDS) {
      expect(registeredClient(clientId)?.client_id).toBe(clientId);
    }
  });

  it('keeps the existing app and dev clients registered alongside them', () => {
    const registeredIds = staticClients().map((client) => client.client_id);
    expect(registeredIds).toEqual(expect.arrayContaining(['app', 'dev']));
  });

  it('offers the authorization-code flow with EdDSA id tokens to every producer', () => {
    for (const clientId of PRODUCER_CLIENT_IDS) {
      const client = registeredClient(clientId);
      expect(client?.grant_types).toContain('authorization_code');
      expect(client?.response_types).toEqual(['code']);
      expect(client?.id_token_signed_response_alg).toBe('EdDSA');
    }
  });
});
