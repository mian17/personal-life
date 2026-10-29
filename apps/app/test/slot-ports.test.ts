import {
  degradedAppPort,
  devPorts,
  pidsFilePath,
  feedbackMqContainer,
  feedbackPgContainer,
  hopEnabled,
  hopPorts,
  redisContainer,
  testPorts,
  testRedisUrl,
} from './e2e/config';

const SLOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

function bandOf(port: number): number {
  return Math.floor(port / 100) * 100;
}

function everyPortInSet(ports: Record<string, number>): number[] {
  return Object.values(ports);
}

function allPortsForSlot(slot: number): number[] {
  return [
    ...everyPortInSet(testPorts(slot)),
    ...everyPortInSet(devPorts(slot)),
    ...everyPortInSet(hopPorts(slot)),
    degradedAppPort(slot),
  ];
}

function containersForSlot(slot: number): string[] {
  return [feedbackPgContainer(slot), feedbackMqContainer(slot), redisContainer(slot)];
}

describe('slot-derived harness ports', () => {
  afterEach(() => {
    delete process.env.E2E_IDP_PORT;
    delete process.env.E2E_DEV_APP_PORT;
    delete process.env.E2E_FOCUS_PORT;
    delete process.env.E2E_DEV_FOCUS_PORT;
    delete process.env.E2E_HOP_A_PORT;
    delete process.env.E2E_DEGRADED_APP_PORT;
    delete process.env.E2E_HOP;
    delete process.env.TEST_REDIS_URL;
    delete process.env.E2E_FEEDBACK_PG_CONTAINER;
    delete process.env.E2E_FEEDBACK_MQ_CONTAINER;
    delete process.env.E2E_REDIS_CONTAINER;
  });

  it('returns the historical port set for slot 0', () => {
    expect(testPorts(0)).toEqual({
      idpPort: 3103,
      notePort: 3101,
      tagsPort: 3104,
      todoPort: 3105,
      mealPort: 3106,
      feedbackPort: 3107,
      focusPort: 3109,
      appPort: 3100,
    });
    expect(devPorts(0)).toEqual({
      idpPort: 3203,
      notePort: 3201,
      tagsPort: 3204,
      todoPort: 3205,
      mealPort: 3206,
      feedbackPort: 3207,
      focusPort: 3209,
      appPort: 3200,
    });
    expect(hopPorts(0)).toEqual({ appAPort: 3310, appBPort: 3311 });
    expect(degradedAppPort(0)).toBe(3108);
  });

  it('shifts every port ten higher per slot', () => {
    const slotZero = testPorts(0);
    const slotOne = testPorts(1);

    for (const [name, port] of Object.entries(slotZero)) {
      expect(slotOne[name as keyof typeof slotOne]).toBe(port + 10);
    }

    expect(devPorts(1).appPort).toBe(devPorts(0).appPort + 10);
    expect(hopPorts(1)).toEqual({ appAPort: 3320, appBPort: 3321 });
    expect(degradedAppPort(1)).toBe(3118);
  });

  it('keeps every port inside its documented band', () => {
    for (const slot of SLOTS) {
      for (const port of everyPortInSet(testPorts(slot))) expect(bandOf(port)).toBe(3100);
      for (const port of everyPortInSet(devPorts(slot))) expect(bandOf(port)).toBe(3200);
      for (const port of everyPortInSet(hopPorts(slot))) expect(bandOf(port)).toBe(3300);
      expect(bandOf(degradedAppPort(slot))).toBe(3100);
    }
  });

  it('gives any two distinct slots disjoint port sets', () => {
    for (const slot of SLOTS) {
      for (const otherSlot of SLOTS) {
        if (otherSlot === slot) continue;

        const sharedPorts = allPortsForSlot(slot).filter((port) =>
          allPortsForSlot(otherSlot).includes(port),
        );
        expect(sharedPorts).toEqual([]);
      }
    }
  });

  it('names the throwaway feedback Postgres container after the slot', () => {
    expect(feedbackPgContainer(0)).toBe('feedback-pg-e2e-0');
    expect(feedbackPgContainer(1)).toBe('feedback-pg-e2e-1');
  });

  it('names the throwaway RabbitMQ container after the slot', () => {
    expect(feedbackMqContainer(0)).toBe('feedback-mq-e2e-0');
    expect(feedbackMqContainer(1)).toBe('feedback-mq-e2e-1');
  });

  it('names the throwaway Redis container after the slot', () => {
    expect(redisContainer(0)).toBe('redis-e2e-0');
    expect(redisContainer(1)).toBe('redis-e2e-1');
  });

  it('keeps every slot container name derived from its slot', () => {
    for (const slot of SLOTS) {
      expect(containersForSlot(slot)).toEqual([
        `feedback-pg-e2e-${slot}`,
        `feedback-mq-e2e-${slot}`,
        `redis-e2e-${slot}`,
      ]);
    }
  });

  it('gives any two distinct slots disjoint container names', () => {
    for (const slot of SLOTS) {
      for (const otherSlot of SLOTS) {
        if (otherSlot === slot) continue;

        const sharedNames = containersForSlot(slot).filter((name) =>
          containersForSlot(otherSlot).includes(name),
        );
        expect(sharedNames).toEqual([]);
      }
    }
  });

  it('lets an explicit env override win over the derived value in any slot', () => {
    process.env.E2E_IDP_PORT = '4103';
    process.env.E2E_DEV_APP_PORT = '4200';
    process.env.E2E_FOCUS_PORT = '4109';
    process.env.E2E_DEV_FOCUS_PORT = '4209';
    process.env.E2E_HOP_A_PORT = '4310';
    process.env.E2E_DEGRADED_APP_PORT = '4108';
    process.env.E2E_FEEDBACK_PG_CONTAINER = 'feedback-pg-e2e-pinned';
    process.env.E2E_FEEDBACK_MQ_CONTAINER = 'feedback-mq-e2e-pinned';
    process.env.E2E_REDIS_CONTAINER = 'redis-e2e-pinned';

    expect(testPorts(3).idpPort).toBe(4103);
    expect(devPorts(3).appPort).toBe(4200);
    expect(testPorts(3).focusPort).toBe(4109);
    expect(devPorts(3).focusPort).toBe(4209);
    expect(hopPorts(3).appAPort).toBe(4310);
    expect(degradedAppPort(3)).toBe(4108);
    expect(feedbackPgContainer(3)).toBe('feedback-pg-e2e-pinned');
    expect(feedbackMqContainer(3)).toBe('feedback-mq-e2e-pinned');
    expect(redisContainer(3)).toBe('redis-e2e-pinned');
  });

  it('runs the two-replica hop proof only for E2E_HOP=1', () => {
    expect(hopEnabled()).toBe(false);

    for (const value of ['0', 'true', 'yes', ' 1', '']) {
      process.env.E2E_HOP = value;
      expect(hopEnabled()).toBe(false);
    }

    process.env.E2E_HOP = '1';
    expect(hopEnabled()).toBe(true);
  });

  it('keeps the recorded-PID file inside this worktree, not shared between worktrees', () => {
    process.env.E2E_REPO_ROOT = '/tmp/worktree-alpha';

    const alpha = pidsFilePath('service-pids-prod.json');
    process.env.E2E_REPO_ROOT = '/tmp/worktree-beta';

    expect(alpha).toMatch(/worktree-alpha-service-pids-prod\.json$/);
    expect(pidsFilePath('service-pids-prod.json')).not.toBe(alpha);
  });

  it('reports a pinned TEST_REDIS_URL trimmed, and undefined when unset or blank', () => {
    expect(testRedisUrl()).toBeUndefined();

    process.env.TEST_REDIS_URL = '   ';
    expect(testRedisUrl()).toBeUndefined();

    process.env.TEST_REDIS_URL = '  redis://127.0.0.1:6399  ';
    expect(testRedisUrl()).toBe('redis://127.0.0.1:6399');
  });
});
