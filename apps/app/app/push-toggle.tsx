'use client';

import { useEffect, useState } from 'react';
import { StatusText, Switch } from '@life/ui';
import { subscribeToPush, unsubscribeFromPush } from '@/lib/push-client';

declare global {
  interface Navigator {
    /** iOS Safari exposes Home Screen install state here. */
    standalone?: boolean;
  }
}

/**
 * Push reminder opt-in. Browser capability is read in an effect (never
 * server-seeded) so the first paint matches the server render. Three states:
 * unsupported, not installed to the Home Screen, and subscribable.
 */
export function PushToggle() {
  const [supported, setSupported] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    setSupported('serviceWorker' in navigator && 'PushManager' in window);
    setInstalled(Boolean(navigator.standalone));
    if (typeof Notification !== 'undefined') setPermission(Notification.permission);
  }, []);

  async function toggle(next: boolean) {
    setBusy(true);
    const result = next ? await subscribeToPush() : await unsubscribeFromPush();
    setBusy(false);
    if (typeof Notification !== 'undefined') setPermission(Notification.permission);
    if (result.ok) setOn(next);
  }

  if (!supported) {
    return <StatusText>Push reminders are not supported in this browser.</StatusText>;
  }
  if (!installed) {
    return <StatusText>Add this app to your Home Screen to turn on push reminders.</StatusText>;
  }
  if (permission === 'denied') {
    return <StatusText>Notifications are blocked. Allow them in your browser settings.</StatusText>;
  }

  return (
    <Switch
      label="Push reminders"
      checked={on}
      disabled={busy}
      onCheckedChange={(next) => void toggle(next)}
    />
  );
}
