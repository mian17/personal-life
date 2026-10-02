'use client';

import { getPushKeyAction, subscribePushAction, unsubscribePushAction } from '@/app/todo-actions';

/**
 * Browser push client for todo reminders. Reads the VAPID key through the
 * `getPushKeyAction` server action — the client never imports the server-only
 * `lib/todo-api.ts`. Every failure resolves to `{ ok: false, reason }`; this
 * module never throws.
 */

export type PushResult = { ok: boolean; reason?: string };

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Whether this device already holds an active push subscription (drives the toggle's initial state). */
export async function hasPushSubscription(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration('/sw.js');
    return Boolean(await registration?.pushManager.getSubscription());
  } catch {
    return false;
  }
}

export async function subscribeToPush(): Promise<PushResult> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: 'unsupported' };
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    const { publicKey } = await getPushKeyAction();
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    const json = subscription.toJSON();
    await subscribePushAction({
      endpoint: subscription.endpoint,
      keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof DOMException && Notification.permission === 'denied') {
      return { ok: false, reason: 'denied' };
    }
    if (!('serviceWorker' in navigator)) return { ok: false, reason: 'unsupported' };
    return { ok: false, reason: 'not-installed' };
  }
}

export async function unsubscribeFromPush(): Promise<PushResult> {
  if (!('serviceWorker' in navigator)) return { ok: false, reason: 'unsupported' };

  try {
    const registration = await navigator.serviceWorker.getRegistration('/sw.js');
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return { ok: true };
    const { endpoint } = subscription;
    await subscription.unsubscribe();
    await unsubscribePushAction(endpoint);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'not-installed' };
  }
}
