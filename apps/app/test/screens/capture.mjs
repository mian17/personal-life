#!/usr/bin/env node
/**
 * Screenshot capture harness for the personal-life app.
 *
 * Attaches to an ALREADY RUNNING dev server — no build, no service boot, no
 * Playwright global setup — and writes one 414x896 CSS px (@2x) PNG per screen
 * listed in `screens.config.json`, plus the `manifest.json` that `gallery.mjs`
 * renders.
 *
 *   npm run screens -w apps/app            # from the repo root
 *   SCREENS_BASE_URL=http://127.0.0.1:3100 # default
 *
 * The app's identity gate answers `/auth/login` without a session cookie, so a
 * run needs a logged-in state: save one from a real browser and point
 * `SCREENS_STORAGE_STATE` at that JSON file.
 *
 * A screen whose `route` carries `{placeholder}` tokens is resolved from
 * `screens.ids.json` (written by `seed.mjs`) at capture time. When an id is
 * missing, that screen is recorded as failed with the reason — the static
 * screens still capture, and the manifest says why the dynamic one is absent.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
// Repo root comes from this file, not `process.cwd()`: `npm run screens
// -w apps/app` runs with the cwd set to `apps/app`, where a cwd-relative
// `docs/` path would land inside the workspace.
const repoRoot = join(here, '..', '..', '..', '..');
const screensDir = join(repoRoot, 'docs', 'design-systems', 'personal-life', 'screens');
const manifestPath = join(screensDir, 'manifest.json');

const baseUrl = (process.env.SCREENS_BASE_URL?.trim() || 'http://127.0.0.1:3100').replace(/\/+$/, '');
const storageState = process.env.SCREENS_STORAGE_STATE?.trim() || undefined;
const viewport = { width: 414, height: 896 };
const deviceScaleFactor = 2;
const navigationTimeoutMs = 30_000;

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
  const context = await browser.newContext({ viewport, deviceScaleFactor, storageState });
  for (const screen of screens) {
    const file = `${screen.slug}.png`;
    const path = join(screensDir, file);
    const page = await context.newPage();
    try {
      const route = resolveRoute(screen.route);
      if (route === undefined) {
        throw new Error(`unresolved route ${screen.route}: no matching id in screens.ids.json (run seed.mjs)`);
      }
      const response = await page.goto(baseUrl + route, {
        waitUntil: 'load',
        timeout: navigationTimeoutMs,
      });
      const landed = new URL(page.url()).pathname;
      if (landed.startsWith('/auth/')) {
        throw new Error(`redirected to ${landed}: no session cookie (set SCREENS_STORAGE_STATE)`);
      }
      const status = response?.status() ?? 0;
      if (status >= 400) throw new Error(`HTTP ${status} for ${route}`);
      await page.screenshot({ path });
      captured.push({ ...screen, route, file, status: 'ok' });
      console.log(`ok   ${screen.slug}`);
    } catch (error) {
      // A PNG left over from an earlier run would misrepresent this one.
      rmSync(path, { force: true });
      const reason = String(error.message).split('\n')[0];
      captured.push({ ...screen, file, status: 'failed', reason });
      console.log(`fail ${screen.slug} — ${reason}`);
    } finally {
      await page.close();
    }
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
