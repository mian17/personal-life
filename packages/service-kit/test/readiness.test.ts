import { jest } from '@jest/globals';
import { runReadinessChecks, type HealthBody } from '../src/readiness.js';

/** The `503`-shaped error the Nest apps raise; a plain Error proves the identity. */
class Degraded extends Error {
  readonly status = 'degraded';
}

const degraded = () => new Degraded('degraded');

describe('runReadinessChecks (the shared service-kernel readiness contract)', () => {
  it('reports ok when both checks pass, running the DB probe before key custody', async () => {
    const order: string[] = [];
    const body = await runReadinessChecks({
      queryDatabase: async () => {
        order.push('db');
        return 1;
      },
      assertKeyCustody: () => order.push('keys'),
      degraded,
    });

    expect(body).toEqual({ status: 'ok' } satisfies HealthBody);
    expect(order).toEqual(['db', 'keys']);
  });

  it('throws the caller-supplied degraded error when the DB probe fails', async () => {
    const assertKeyCustody = jest.fn();
    const error = new Degraded('degraded');
    const run = runReadinessChecks({
      queryDatabase: async () => {
        throw new Error('ECONNREFUSED');
      },
      assertKeyCustody,
      degraded: () => error,
    });

    await expect(run).rejects.toBe(error);
    // Short-circuit: a failed DB probe must not also report a key-custody problem.
    expect(assertKeyCustody).not.toHaveBeenCalled();
  });

  it('throws the caller-supplied degraded error when key custody is unconfigured', async () => {
    const error = new Degraded('degraded');
    const run = runReadinessChecks({
      queryDatabase: async () => 1,
      assertKeyCustody: () => {
        throw new Error('MASTER_KEY missing');
      },
      degraded: () => error,
    });

    await expect(run).rejects.toBe(error);
  });

  it('never leaks the underlying failure message into the degraded error', async () => {
    const run = runReadinessChecks({
      queryDatabase: async () => {
        throw new Error('password=hunter2 host=db');
      },
      assertKeyCustody: () => undefined,
      degraded,
    });

    await expect(run).rejects.toThrow(/^degraded$/);
  });
});
