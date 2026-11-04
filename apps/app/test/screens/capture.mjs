#!/usr/bin/env node
/**
 * Screenshot capture harness for the personal-life app.
 *
 * Attaches to an ALREADY RUNNING dev server — no build, no service boot, no
 * Playwright global setup — and writes one 414x896 CSS px (@2x) PNG per screen
 * per theme (light and dark), for every screen listed in `screens.config.json`,
 * plus the `manifest.json` that `gallery.mjs` renders.
 *
 *   npm run screens -w apps/app             # from the repo root
 *   SCREENS_BASE_URL=http://localhost:3100   # default
 *   SCREENS_OUT_DIR=docs/design-systems/personal-life/screens-applied/8b32307
 *                                           # default: .../personal-life/screens
 *
 * `SCREENS_OUT_DIR` is where the PNGs and `manifest.json` of this run go, so a
 * per-commit capture writes its own folder instead of overwriting the reference
 * set. Relative paths resolve from the repo root (see below), never the cwd.
 *
 * The app's identity gate answers `/auth/login` without a session cookie, so a
 * run needs a logged-in state: save one from a real browser and point
 * `SCREENS_STORAGE_STATE` at that JSON file.
 *
 * A screen whose `route` carries `{placeholder}` tokens is resolved from
 * `screens.ids.json` (written by `seed.mjs`) at capture time. When an id is
 * missing, that screen is recorded as failed with the reason — the static
 * screens still capture, and the manifest says why the dynamic one is absent.
 *
 * `SCREENS_BASE_URL` must name the origin the saved session cookie belongs to.
 * The app canonicalizes `127.0.0.1` to `localhost` during login, so the cookie
 * lands on `localhost`; the browser then refuses to send it to `127.0.0.1`, and
 * every screen bounces through `/auth/login` instead of loading. That is why the
 * default is `localhost` rather than the loopback literal.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
// Repo root comes from this file, not `process.cwd()`: `npm run screens
// -w apps/app` runs with the cwd set to `apps/app`, where a cwd-relative
// `docs/` path would land inside the workspace.
const repoRoot = join(here, '..', '..', '..', '..');
const defaultScreensDir = join(repoRoot, 'docs', 'design-systems', 'personal-life', 'screens');
// An override is resolved the same way, for the same reason: a relative
// `SCREENS_OUT_DIR` must mean the same folder from any cwd.
const screensDirOverride = process.env.SCREENS_OUT_DIR?.trim();
const screensDir = screensDirOverride ? resolve(repoRoot, screensDirOverride) : defaultScreensDir;
const manifestPath = join(screensDir, 'manifest.json');

const baseUrl = (process.env.SCREENS_BASE_URL?.trim() || 'http://localhost:3100').replace(/\/+$/, '');
const storageState = process.env.SCREENS_STORAGE_STATE?.trim() || undefined;
const viewport = { width: 414, height: 896 };
const deviceScaleFactor = 2;
const navigationTimeoutMs = 30_000;

/** Every screen is shot in each of these, in this order. */
const themes = ['light', 'dark'];

/**
 * How long a screen may take to finish painting after `load`.
 *
 * Client-rendered content is absent from the server HTML: recharts' chart appears
 * only once React has hydrated and `ResponsiveContainer` has measured itself, so
 * shooting straight after `load` captured the wait as an empty plot box — the
 * chart's reserved width and height, and no bars in it. The wait below is a
 * condition, never a sleep; this budget only bounds how long a genuinely broken
 * screen may hold up a 29-screen run.
 */
const settleTimeoutMs = 5_000;

/** Same main-frame path this many times in one screen is a redirect loop, not a slow page. */
const navigationLoopLimit = 5;

/**
 * Ceiling on one screen from `newPage` to its record, on top of the per-step timeouts.
 *
 * Each step is bounded on its own (navigation 30s, settle 5s), but a screen that is
 * redirected in a circle has no failing step at all — every hop answers 200 or 303 and
 * the document is replaced before `load` can settle, so the per-step budgets never fire.
 * This is the budget that ends such a screen with a reason instead of a hung run.
 */
const screenTimeoutMs = 60_000;

const { screens } = JSON.parse(readFileSync(join(here, 'screens.config.json'), 'utf8'));
const idsFile = join(here, 'screens.ids.json');
const ids = existsSync(idsFile) ? JSON.parse(readFileSync(idsFile, 'utf8')).ids ?? {} : {};
const gitSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();

/** `{note}` → the seeded id; `undefined` when the token has no value yet. */
function resolveRoute(route) {
  const token = /\{(\w+)\}/.exec(route);
  if (!token) return route;
  const value = ids[token[1]];
  if (!value) return undefined;
  return resolveRoute(route.replace(token[0], encodeURIComponent(value)));
}

/**
 * Wait until the page has painted its client-rendered content, or the budget runs
 * out — whichever comes first. The answer is only ever recorded: a screen with no
 * chart has nothing to settle on, and a slow one still gets its screenshot, so the
 * manifest says what the run actually saw instead of failing a screen that
 * rendered late.
 */
async function settlePage(page) {
  const deadline = Date.now() + settleTimeoutMs;
  const quietNetwork = await waitForNetworkQuiet(page, deadline);
  const paintedCharts = await waitForPaintedCharts(page, deadline);
  if (quietNetwork && paintedCharts) return 'settled';
  // Named separately: a chart that painted on a noisy dev server is a different
  // thing to see in the manifest than a plot that never drew a bar.
  if (!paintedCharts) return 'paint-timeout';
  return 'network-timeout';
}

/**
 * A dev server may hold a stream open longer than the budget, so this step falls
 * through to the paint check rather than aborting the screen.
 */
async function waitForNetworkQuiet(page, deadline) {
  try {
    await page.waitForLoadState('networkidle', { timeout: Math.max(1, deadline - Date.now()) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Waits for every `[role="img"]` figure to hold a chart svg that has been measured
 * to a non-zero width.
 *
 * The measured svg is the honest signal, and a DOM-mutation quiet period is not:
 * an unhydrated figure contains no `<svg>` at all, so "every svg has width" is
 * vacuously true right up to the frame the chart paints, and a gap between two
 * async renders would read as quiet while the plot still had no bars. A figure
 * that never grows an svg is what times the budget out.
 */
async function waitForPaintedCharts(page, deadline) {
  try {
    return await page.evaluate(
      (budgetMs) => new Promise((resolve) => {
        const deadlineAt = performance.now() + budgetMs;
        const isPainted = (figure) => {
          const svgs = [...figure.querySelectorAll('svg')];
          return svgs.length > 0 && svgs.every((svg) => svg.getBoundingClientRect().width > 0);
        };
        const tick = () => {
          const figures = [...document.querySelectorAll('[role="img"]')];
          if (figures.every(isPainted)) return resolve(true);
          if (performance.now() > deadlineAt) return resolve(false);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
      Math.max(1, deadline - Date.now()),
    );
  } catch {
    // A navigation that replaces the document mid-wait tears its context down.
    return false;
  }
}

/**
 * Runs one screen's work under the wall-clock ceiling, so no single step can hold up the
 * whole run. Whatever the abandoned work does next is irrelevant: the page is closed in
 * the caller's `finally`, and a closed page aborts any navigation still in flight.
 */
function withScreenBudget(work) {
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`screen exceeded its ${screenTimeoutMs}ms budget`)),
      screenTimeoutMs,
    );
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

/**
 * Counts document loads of one path and surfaces the moment it repeats: a redirect circle
 * answers every hop instantly, so it never trips a per-step timeout, and a same-document
 * history call (which `framenavigated` also reports) is not a reload and must not count.
 */
function watchForRedirectLoop(page) {
  const loads = new Map();
  let breach;
  const tripped = new Promise((_, reject) => {
    breach = reject;
  });
  const onDocumentRequest = (request) => {
    if (request.resourceType() !== 'document') return;
    const path = new URL(request.url()).pathname;
    const seen = (loads.get(path) ?? 0) + 1;
    loads.set(path, seen);
    if (seen === navigationLoopLimit) {
      breach(new Error(`redirect loop: ${path} loaded ${seen} times (check SCREENS_BASE_URL matches the session cookie's origin)`));
    }
  };
  page.on('request', onDocumentRequest);
  return { tripped, stop: () => page.off('request', onDocumentRequest) };
}

/** Navigates, refusing to wait forever when the app is bouncing the browser in a circle. */
async function loadScreen(page, url) {
  const loop = watchForRedirectLoop(page);
  try {
    return await Promise.race([
      page.goto(url, { waitUntil: 'load', timeout: navigationTimeoutMs }),
      loop.tripped,
    ]);
  } finally {
    loop.stop();
  }
}

mkdirSync(screensDir, { recursive: true });

let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  // No manifests are written here: a browser-less run has captured nothing, and
  // overwriting the manifest would erase the previous run's gallery.
  console.error(`Cannot start Chromium: ${error.message}`);
  console.error('Install the browser once with `npx playwright install chromium`, then re-run.');
  process.exit(1);
}

const captured = [];
try {
  for (const theme of themes) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor,
      storageState,
      colorScheme: theme,
    });
    // Both theme levers, set per page. The app's inline script in `layout.tsx` copies
    // `localStorage['calm-theme']` into `data-theme`, and `tokens.css` also keys its light
    // values off `prefers-color-scheme` for a root with no `data-theme`. Setting only
    // one would leave the other in charge of part of the palette: the init script
    // claims `localStorage` before any page script runs, `colorScheme` claims the
    // media query, so neither can leak the wrong theme into a screenshot. The key is
    // the one `theme-toggle.tsx` writes, so a shot and a visitor's choice share it.
    await context.addInitScript((value) => {
      try {
        localStorage.setItem('calm-theme', value);
      } catch {
        // A blocked store leaves the media query above to decide; nothing to do.
      }
    }, theme);
    for (const screen of screens) {
      const file = `${screen.slug}-${theme}.png`;
      const path = join(screensDir, file);
      const page = await context.newPage();
      try {
        const route = resolveRoute(screen.route);
        if (route === undefined) {
          throw new Error(`unresolved route ${screen.route}: no matching id in screens.ids.json (run seed.mjs)`);
        }
        const response = await withScreenBudget(
          (async () => {
            const landed = await loadScreen(page, baseUrl + route);
            const path = new URL(page.url()).pathname;
            if (path.startsWith('/auth/')) {
              throw new Error(`redirected to ${path}: no session cookie (set SCREENS_STORAGE_STATE)`);
            }
            const status = landed?.status() ?? 0;
            if (status >= 400) throw new Error(`HTTP ${status} for ${route}`);
            return { settle: await settlePage(page) };
          })(),
        );
        await page.screenshot({ path });
        // `settle` rides along only when it ran out, so a normal manifest keeps its shape.
        const unsettled = response.settle === 'settled' ? {} : { settle: response.settle };
        captured.push({ ...screen, theme, route, file, status: 'ok', ...unsettled });
        console.log(`ok   ${screen.slug} [${theme}]`);
        if (response.settle !== 'settled') {
          console.warn(`     ${screen.slug} [${theme}]: ${response.settle} after ${settleTimeoutMs}ms — captured anyway`);
        }
      } catch (error) {
        // A PNG left over from an earlier run would misrepresent this one.
        rmSync(path, { force: true });
        const reason = String(error.message).split('\n')[0];
        captured.push({ ...screen, theme, file, status: 'failed', reason });
        console.log(`fail ${screen.slug} [${theme}] — ${reason}`);
      } finally {
        await page.close();
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}

const manifest = {
  viewport: { ...viewport, dpr: deviceScaleFactor },
  gitSha,
  capturedAt: new Date().toISOString(),
  screens: captured,
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const failed = captured.filter((screen) => screen.status !== 'ok').length;
console.log(`${captured.length - failed}/${captured.length} captured, ${failed} failed → ${manifestPath}`);
process.exitCode = failed === 0 ? 0 : 1;
