import webpush from 'web-push';
import {
  WebPushSender,
  VAPID_PRIVATE_KEY_ENV,
  VAPID_PUBLIC_KEY_ENV,
} from '../src/reminders/push-sender.js';

/**
 * Regression for the Node ESM export shape of `web-push`. A namespace import
 * (`import * as webpush`) exposes only `{ WebPushError, default,
 * supportedContentEncodings }`, so `setVapidDetails` was `undefined` and the
 * service died at boot once VAPID keys were present. Constructing the real
 * adapter with real key material is what exercises that call.
 */
describe('WebPushSender (unit)', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it('constructs against the real web-push lib when VAPID keys are configured', () => {
    const keys = webpush.generateVAPIDKeys();
    process.env[VAPID_PUBLIC_KEY_ENV] = keys.publicKey;
    process.env[VAPID_PRIVATE_KEY_ENV] = keys.privateKey;

    const sender = new WebPushSender({ listFor: async () => [] });

    expect(sender).toBeInstanceOf(WebPushSender);
  });
});
