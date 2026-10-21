import { devPorts } from '../config';
import { registerJourney } from '../suites/journey.suite';

/**
 * The human's full checklist against the dev runtime (`next dev`, `npm run dev`),
 * reached on `127.0.0.1`. This is the mode the loopback bug lived in; the
 * access gate is skipped by the dev-stack flag `APP_DEV_SKIP_ACCESS_GATE=1`.
 */
const { appPort } = devPorts();
registerJourney({
  origin: `http://127.0.0.1:${appPort}`,
  alternateOrigin: `http://localhost:${appPort}`,
});
