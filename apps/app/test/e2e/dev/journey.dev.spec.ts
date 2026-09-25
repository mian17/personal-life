import { devPorts } from '../config';
import { registerJourney } from '../suites/journey.suite';

/**
 * The human's full checklist against the dev runtime (`next dev`, `npm run dev`),
 * reached on `127.0.0.1`. This is the mode the loopback bug lived in; the
 * access gate is skipped in dev by contract.
 */
const { appPort } = devPorts();
registerJourney({
  origin: `http://127.0.0.1:${appPort}`,
  alternateOrigin: `http://localhost:${appPort}`,
});
