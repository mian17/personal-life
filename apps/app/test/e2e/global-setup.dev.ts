import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startStack, type StackConfig } from './stack';
import { devPidsFile, devPorts, repoRoot } from './config';

/**
 * Development-mode e2e stack: `next dev` exactly as `npm run dev` runs it, on
 * scratch DBs. This is the runtime the human actually uses, and the only one
 * where the dev server's middleware loopback-host normalization exists.
 */
export default async function globalSetup(): Promise<void> {
  const { idpPort, notePort, tagsPort, todoPort, mealPort, appPort } = devPorts();
  const cfg: StackConfig = {
    mode: 'development',
    idpPort,
    notePort,
    tagsPort,
    todoPort,
    mealPort,
    appPort,
    // Dev is reached on 127.0.0.1 (the human's URL and the app's default).
    appOrigin: `http://127.0.0.1:${appPort}`,
    stateDir: join(repoRoot(), 'apps/app/.e2e-state-dev'),
  };
  const services = await startStack(cfg);
  writeFileSync(
    join(__dirname, devPidsFile),
    JSON.stringify({ pids: services.map((s) => s.child.pid) }),
  );
}
