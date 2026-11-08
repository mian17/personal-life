import type { ReactElement } from 'react';
import { StatusText, Switch } from '@life/ui';

jest.mock('@/lib/push-client', () => ({
  subscribeToPush: jest.fn(),
  unsubscribeFromPush: jest.fn(),
  hasPushSubscription: jest.fn(),
}));

import { hasPushSubscription, subscribeToPush, unsubscribeFromPush } from '@/lib/push-client';
import { PushToggle } from '@/app/push-toggle';

const mockedSubscribe = subscribeToPush as jest.MockedFunction<typeof subscribeToPush>;
const mockedUnsubscribe = unsubscribeFromPush as jest.MockedFunction<typeof unsubscribeFromPush>;
const mockedHas = hasPushSubscription as jest.MockedFunction<typeof hasPushSubscription>;

// The compiled component reads hooks off the raw `react` module exports at call
// time, so spying there intercepts it (the `import * as React` namespace is a
// frozen copy and cannot be). `apps/app` runs under `testEnvironment: "node"`,
// so `useEffect` is driven by hand: capture the effect, run it once, then
// re-render to observe the capability state it set.
const ReactModule = jest.requireActual<typeof import('react')>('react');
const realUseState = ReactModule.useState;

function renderPushToggle(): { tree: any; restore: () => void } {
  const store: unknown[] = [];
  const stateSpy = jest.spyOn(ReactModule, 'useState');
  const effects: Array<() => void> = [];
  const effectSpy = jest.spyOn(ReactModule, 'useEffect').mockImplementation(((fn: () => void) => {
    effects.push(fn);
  }) as typeof ReactModule.useEffect);

  const render = () => {
    let index = 0;
    stateSpy.mockImplementation(((initial: unknown) => {
      const i = index++;
      if (i >= store.length) {
        store[i] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      }
      const set = (next: unknown) => {
        store[i] =
          typeof next === 'function' ? (next as (prev: unknown) => unknown)(store[i]) : next;
      };
      return [store[i], set];
    }) as typeof realUseState);
    return PushToggle() as unknown as ReactElement<Record<string, unknown>>;
  };

  const first = render();
  void first;
  for (const fn of effects) fn();
  const tree = render();

  return {
    tree,
    restore: () => {
      stateSpy.mockRestore();
      effectSpy.mockRestore();
    },
  };
}

function findNode(node: unknown, type: unknown): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findNode(child, type);
      if (hit) return hit;
    }
    return undefined;
  }
  if (node == null || typeof node !== 'object') return undefined;
  const el = node as ReactElement<Record<string, unknown>>;
  if (el.type === type) return el;
  return findNode(el.props?.children, type);
}

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const realNotification = Object.getOwnPropertyDescriptor(globalThis, 'Notification');

function setEnv({
  push,
  standalone,
  permission,
}: {
  push: boolean;
  standalone: boolean;
  permission?: NotificationPermission;
}) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { serviceWorker: {}, standalone },
  });
  (globalThis as { window?: unknown }).window = push ? { PushManager: function () {} } : {};
  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    value: permission ? { permission } : undefined,
  });
}

afterEach(() => {
  if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
  if (realNotification) Object.defineProperty(globalThis, 'Notification', realNotification);
  delete (globalThis as { window?: unknown }).window;
  jest.clearAllMocks();
});

beforeEach(() => {
  mockedHas.mockResolvedValue(false);
});

describe('PushToggle branches', () => {
  it('unsupported (no PushManager): renders guidance and no control', () => {
    setEnv({ push: false, standalone: true });
    const harness = renderPushToggle();
    try {
      expect(harness.tree.type).toBe(StatusText);
      expect(harness.tree.props.children).toContain('not supported');
      expect(findNode(harness.tree, Switch)).toBeUndefined();
    } finally {
      harness.restore();
    }
  });

  it('not installed to the Home Screen: renders the add-to-Home-Screen guidance', () => {
    setEnv({ push: true, standalone: false });
    const harness = renderPushToggle();
    try {
      expect(harness.tree.type).toBe(StatusText);
      expect(harness.tree.props.children).toContain('Add this app to your Home Screen');
      expect(findNode(harness.tree, Switch)).toBeUndefined();
    } finally {
      harness.restore();
    }
  });

  it('supported and installed: renders the Switch and subscribe calls subscribeToPush', async () => {
    setEnv({ push: true, standalone: true, permission: 'default' });
    mockedSubscribe.mockResolvedValue({ ok: true });
    const harness = renderPushToggle();
    try {
      const control = findNode(harness.tree, Switch);
      expect(control).toBeDefined();
      expect(control!.props.label).toBe('Push reminders');

      (control!.props.onCheckedChange as (next: boolean) => void)(true);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockedSubscribe).toHaveBeenCalledTimes(1);
      expect(mockedUnsubscribe).not.toHaveBeenCalled();
      // The toggle seeds its state from the device's existing subscription.
      expect(mockedHas).toHaveBeenCalled();
    } finally {
      harness.restore();
    }
  });
});
