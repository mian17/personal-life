import { test } from '@playwright/test';
import { devPorts } from '../config';
import { heldSlot } from '../teardown';
import { journeyChecklist } from '../suites/journey.suite';

/**
 * The human's full checklist against the dev runtime (`next dev`, `npm run dev`),
 * reached on `127.0.0.1`. This is the mode the loopback bug lived in; the
 * access gate is skipped by the dev-stack flag `APP_DEV_SKIP_ACCESS_GATE=1`.
 *
 * The shared suite returns the entries; this file owns their `test(...)`
 * registration, so static analysis sees tests in the spec itself.
 */
const { appPort } = devPorts(heldSlot());

test.describe('full journey checklist', () => {
  for (const entry of journeyChecklist({
    origin: `http://127.0.0.1:${appPort}`,
    alternateOrigin: `http://localhost:${appPort}`,
  })) {
    test(entry.title, entry.body);
  }
});
