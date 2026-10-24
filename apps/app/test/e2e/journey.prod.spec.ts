import { testPorts } from './config';
import { heldSlot } from './teardown';
import { registerJourney } from './suites/journey.suite';

/**
 * The human's full checklist against the production build (Docker artifact),
 * reached on `localhost`, with the Tailscale access gate active.
 */
const { appPort } = testPorts(heldSlot());
registerJourney({
  origin: `http://localhost:${appPort}`,
  alternateOrigin: `http://127.0.0.1:${appPort}`,
});
