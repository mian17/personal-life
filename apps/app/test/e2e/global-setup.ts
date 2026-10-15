import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startStack, type StackConfig } from './stack';
import { prodPidsFile, repoRoot, testPorts } from './config';

/**
 * Production-build e2e stack: the real Docker artifact (`next build` output),
 * access gate active, `localhost` origin. Mirrors `docker compose up` behavior.
 */
export default async function globalSetup(): Promise<void> {
  const { idpPort, notePort, tagsPort, todoPort, mealPort, appPort } = testPorts();
  const cfg: StackConfig = {
    mode: 'production',
    idpPort,
    notePort,
    tagsPort,
    todoPort,
    mealPort,
    appPort,
    appOrigin: `http://localhost:${appPort}`,
    // Never under any service's real `data/` directory.
    stateDir: join(repoRoot(), 'apps/app/.e2e-state'),
  };
  const services = await startStack(cfg);
  writeFileSync(
    join(__dirname, prodPidsFile),
    JSON.stringify({ pids: services.map((s) => s.child.pid) }),
  );
}
