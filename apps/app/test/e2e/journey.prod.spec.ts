import { test } from '@playwright/test';
import { testPorts } from './config';
import { heldSlot } from './teardown';
import { journeyChecklist } from './suites/journey.suite';

/**
 * The human's full checklist against the production build (Docker artifact),
 * reached on `localhost`, with the Tailscale access gate active.
 *
 * The shared suite returns the entries; this file owns their `test(...)`
 * registration, so static analysis sees tests in the spec itself.
 */
const { appPort } = testPorts(heldSlot());

test.describe('full journey checklist', () => {
  for (const entry of journeyChecklist({
    origin: `http://localhost:${appPort}`,
    alternateOrigin: `http://127.0.0.1:${appPort}`,
  })) {
    test(entry.title, entry.body);
  }
});
