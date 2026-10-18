import { createServer, type Server } from 'node:net';
import { ensurePortFree } from '../test/e2e/services';

/** Bind an ephemeral port and hand back the address the probe must refuse. */
function occupy(): Promise<{ port: number; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: (server.address() as { port: number }).port, server });
    });
  });
}

describe('ensurePortFree', () => {
  it('resolves when nothing is bound to the port', async () => {
    const { port, server } = await occupy();
    await new Promise((resolve) => server.close(resolve));

    await expect(ensurePortFree(port, 'app')).resolves.toBeUndefined();
  });

  it('rejects with the port and service name when a stale listener holds it', async () => {
    // The failure this guards: a leftover server keeps the port, the fresh one
    // dies with EADDRINUSE, and the run silently tests the stale build.
    const { port, server } = await occupy();
    try {
      await expect(ensurePortFree(port, 'app')).rejects.toThrow(
        `e2e port ${port} (app) is already in use`,
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
