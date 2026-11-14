import { writeFileSync } from 'node:fs';
import { chromium, type Page } from '@playwright/test';
import { startLogin, submitCredentials } from './journey';
import { startStack, type StackConfig } from './stack';
import {
  devPidsFile,
  artifactsDir,
  devPorts,
  pidsFilePath,
  repoRoot,
  E2E_PASSWORD,
  E2E_USER,
} from './config';
import { claimSlotForRun } from './slot-queue';
import { recordHeldSlot, releaseHeldSlot, stopRecorded } from './teardown';

/**
 * Development-mode e2e stack: `next dev` exactly as `npm run dev` runs it, on
 * scratch DBs. This is the runtime the human actually uses, and the only one
 * where the dev server's middleware loopback-host normalization exists.
 *
 * The dev harness claims a slot of its own, before `next dev` boots, so a dev
 * run never inherits a production run's claim and two worktrees running dev at
 * once land on different 32xx bands. A setup that aborts hands the slot back
 * here; `global-teardown.dev.ts` hands it back on every other exit path.
 */
export default async function globalSetup(): Promise<void> {
  const claim = claimSlotForRun(repoRoot());
  recordHeldSlot(claim);

  try {
    const config = developmentStackConfig(claim.slot);
    const services = await startStack(config);
    recordServicePids(services.map((service) => service.child.pid));
    await warmEveryRouteTheSuiteVisits(config.appOrigin);
  } catch (error) {
    // Playwright skips `globalTeardown` when setup throws, so the stack this run
    // started has to be reaped here or it answers the next run's port preflight.
    await stopRecorded(devPidsFile);
    releaseHeldSlot();
    throw error;
  }
}

function developmentStackConfig(slot: number): StackConfig {
  const { idpPort, notePort, tagsPort, todoPort, mealPort, focusPort, appPort } = devPorts(slot);

  return {
    mode: 'development',
    idpPort,
    notePort,
    tagsPort,
    todoPort,
    mealPort,
    focusPort,
    appPort,
    // Dev is reached on 127.0.0.1 (the human's URL and the app's default).
    appOrigin: `http://127.0.0.1:${appPort}`,
    // Outside the repository: this lane boots `next dev`, whose Turbopack
    // watches `apps/app`, so scratch writes in there reload the page under test.
    stateDir: artifactsDir('e2e-state-dev', slot),
    slot,
  };
}

/**
 * Every route the dev suite navigates to. `next dev` compiles a route on the
 * first request it serves, and that compile is the whole difference between the
 * suite passing and a 15s assertion expiring: on one cold boot the dev server's
 * own trace measured `/auth/login` at 1887ms, `/pomodoro` at 1753ms, `/todos` at
 * 1737ms and `/meals` at 1508ms, against 60ms for `/notes/trash` once warm. A
 * root `npm test` reaches this leg with the machine already loaded by every
 * other workspace's suite, which is when the first compile is slowest — so the
 * harness pays each one here, before any spec's assertion clock starts.
 */
const ROUTES_THE_SUITE_VISITS = [
  '/',
  '/notes',
  '/notes/new',
  '/notes/settings',
  '/notes/trash',
  '/todos',
  '/meals',
  '/pomodoro',
] as const;

/** How long one route may take to answer before the run refuses to start. */
const ROUTE_READY_DEADLINE_MS = 120_000;

/** Pause between attempts, so a route that is still compiling is not hammered. */
const RETRY_INTERVAL_MS = 250;

/**
 * Waits until the dev server actually serves every route the suite touches.
 *
 * It must be a logged-in browser rather than a `fetch`: every page route sits
 * behind the identity gate, so an unauthenticated request is answered by the
 * proxy's redirect and `next dev` never compiles the page at all. That is why
 * the harness's own readiness gate — `waitForHttp` on `/auth/login`, the one
 * public route — left the suite racing the first compile of everything else.
 */
async function warmEveryRouteTheSuiteVisits(appOrigin: string): Promise<void> {
  const browser = await chromium.launch();
  try {
    // `globalSetup` runs outside the test fixtures, so nothing hands this page a
    // `baseURL`; without it the helpers' relative `goto('/notes')` is an invalid
    // URL. Seeding it from the stack origin keeps the probe on the same helpers
    // the specs use.
    const page = await browser.newPage({ baseURL: appOrigin });
    const servingOrigin = await logInWithoutAssertingTheUi(page, appOrigin);
    for (const route of ROUTES_THE_SUITE_VISITS) await warmRoute(page, servingOrigin, route);
  } finally {
    await browser.close();
  }
}

/**
 * Logs in and returns the origin the app actually served the session on.
 *
 * That origin is not `appOrigin`: Next's middleware rewrites every loopback
 * host in a redirect to `localhost`, so the browser and its session cookie end
 * up on `http://localhost:<port>` even though the harness dialled
 * `127.0.0.1`. Probing the dialled origin afterwards would send no cookie and be
 * answered by the login wall on every attempt.
 *
 * Deliberately not `journey.logIn`: that helper ends on an assertion about the
 * notes UI, and an assertion is the wrong shape for a readiness step — it would
 * turn a slow first compile into a setup failure a moment before the retry loop
 * below would have absorbed it.
 */
async function logInWithoutAssertingTheUi(page: Page, appOrigin: string): Promise<string> {
  await startLogin(page);
  await submitCredentials(page, E2E_USER, E2E_PASSWORD);
  await page.waitForURL((url) => url.pathname === '/notes', { timeout: ROUTE_READY_DEADLINE_MS });
  const servingOrigin = new URL(page.url()).origin;
  if (servingOrigin === appOrigin) return servingOrigin;
  console.log(`[dev-readiness] app served the session on ${servingOrigin}`);
  return servingOrigin;
}

/**
 * One route's first authenticated response, retried until it serves. Logs the
 * time it took, which is the compile cost while the route is still cold.
 */
async function warmRoute(page: Page, appOrigin: string, route: string): Promise<void> {
  const startedAt = Date.now();
  let lastOutcome = 'never answered';

  while (Date.now() - startedAt < ROUTE_READY_DEADLINE_MS) {
    const outcome = await requestRoute(page, appOrigin, route);
    if (outcome.kind === 'served') {
      console.log(`[dev-readiness] ${route} ${outcome.status} in ${Date.now() - startedAt}ms`);
      return;
    }
    lastOutcome = outcome.detail;
    await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
  }

  throw new Error(
    `dev server never served ${route} within ${ROUTE_READY_DEADLINE_MS}ms: ${lastOutcome}`,
  );
}

type RouteOutcome = { kind: 'served'; status: number } | { kind: 'not-ready'; detail: string };

/**
 * Asks for one route. A 5xx is the app refusing, not a compile in flight, and a
 * bounce to the IdP means the probe's session is gone — both are reported as
 * "not ready" so the caller retries rather than treating a wrong answer as a
 * warm route.
 */
async function requestRoute(page: Page, appOrigin: string, route: string): Promise<RouteOutcome> {
  try {
    const response = await page.goto(`${appOrigin}${route}`, { waitUntil: 'commit' });
    const status = response?.status() ?? 0;
    if (landedOnLoginWall(page))
      return { kind: 'not-ready', detail: 'redirected to the login wall' };
    if (status > 0 && status < 500) return { kind: 'served', status };
    return { kind: 'not-ready', detail: `status ${status}` };
  } catch (error) {
    return { kind: 'not-ready', detail: error instanceof Error ? error.message : String(error) };
  }
}

function landedOnLoginWall(page: Page): boolean {
  const path = new URL(page.url()).pathname;
  return path.startsWith('/interaction/') || path === '/login';
}

/** Leaves the PIDs for `global-teardown.dev.ts`, which stops what this run started. */
function recordServicePids(pids: (number | undefined)[]): void {
  writeFileSync(pidsFilePath(devPidsFile), JSON.stringify({ pids }));
}
