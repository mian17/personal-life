import { join } from 'node:path';

/** Test ports (31xx) so a running Docker stack on 300x is never disturbed. */
export function testPorts() {
  return {
    idpPort: Number(process.env.E2E_IDP_PORT ?? 3103),
    notePort: Number(process.env.E2E_NOTE_PORT ?? 3101),
    appPort: Number(process.env.E2E_APP_PORT ?? 3100),
  };
}

/** Where global-setup records the spawned PIDs for global-teardown. */
export const servicePidsFile = 'service-pids.json';

export function repoRoot(): string {
  return process.env.E2E_REPO_ROOT ?? join(__dirname, '..', '..', '..', '..');
}

/** The Tailscale owner used by the Playwright context (access gate). */
export const E2E_OWNER = 'e2e-owner@example.com';
