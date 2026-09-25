import { spawnService, waitForHttp, type SpawnedService } from './services';
import { E2E_APP_SECRET, E2E_OWNER, repoRoot } from './config';

/**
 * A second, isolated production app instance for behavior 12 (IdP unreachable).
 *
 * The shared harness app points at a live IdP, so the only way to prove the
 * degraded branch at browser level without disturbing the shared IdP service is
 * to boot another app from the same standalone build with `IDP_ISSUER` aimed at
 * a dead port. Nothing ever listens there, so starting the login dance fails at
 * discovery.
 *
 * Reuses the production artifact `global-setup.ts` already built (and whose
 * static assets it copied in), so this adds no build cost.
 */

/** App port for the degraded instance (clear of the 31xx shared-stack ports). */
const DEGRADED_APP_PORT = 3199;
/** Port with no listener on purpose: the "unreachable IdP". */
const DEAD_IDP_PORT = 3198;

export interface DegradedApp {
  origin: string;
  service: SpawnedService;
  stop: () => Promise<void>;
}

export async function startDegradedApp(): Promise<DegradedApp> {
  const service = await spawnService({
    name: 'app-degraded',
    command: 'node',
    args: ['.next/standalone/apps/app/server.js'],
    cwd: `${repoRoot()}/apps/app`,
    env: {
      NODE_ENV: 'production',
      PORT: String(DEGRADED_APP_PORT),
      HOSTNAME: '127.0.0.1',
      // The whole point: an address nothing answers on.
      IDP_ISSUER: `http://127.0.0.1:${DEAD_IDP_PORT}`,
      OIDC_APP_CLIENT_ID: 'app',
      OIDC_APP_CLIENT_SECRET: E2E_APP_SECRET,
      OIDC_APP_REDIRECT_URI: `http://localhost:${DEGRADED_APP_PORT}/auth/callback`,
      // Production keeps the access gate active; the spec carries the owner header.
      OWNER_LOGIN: E2E_OWNER,
    },
  });

  const origin = `http://localhost:${DEGRADED_APP_PORT}`;
  // `/` without a session answers a sub-500 redirect/forbidden once booted.
  await waitForHttp(`${origin}/`, 60_000);
  return { origin, service, stop: service.stop };
}
