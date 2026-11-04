#!/usr/bin/env node
/**
 * Renders `manifest.json` (written by `capture.mjs`) into one self-contained
 * HTML gallery: inline CSS, no CDN, no external fonts, no images beyond the
 * PNGs sitting next to it.
 *
 *   node test/screens/gallery.mjs
 *   SCREENS_OUT_DIR=docs/design-systems/personal-life/screens-applied/8b32307 node test/screens/gallery.mjs
 *
 * Runs before any capture: with no manifest it writes the same page in its
 * zero-capture state, so an operator always finds the command they need.
 *
 * The page lands beside the capture folder, named `<folder>-gallery.html`, and
 * links `<folder>/<file>` — so a per-commit folder gets its own gallery whose
 * images still resolve, and the default set keeps `screens-gallery.html`.
 * `SCREENS_OUT_DIR` means one thing to both scripts: where this run's PNGs and
 * `manifest.json` go. Relative paths resolve from the repo root (see below).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const defaultScreensDir = join(repoRoot, 'docs', 'design-systems', 'personal-life', 'screens');
// Resolved against the repo root for the same reason `capture.mjs` does: the cwd
// of `npm run screens -w apps/app` is `apps/app`.
const screensDirOverride = process.env.SCREENS_OUT_DIR?.trim();
const screensDir = screensDirOverride ? resolve(repoRoot, screensDirOverride) : defaultScreensDir;
const manifestPath = join(screensDir, 'manifest.json');
const screensName = basename(screensDir);
const galleryPath = join(dirname(screensDir), `${screensName}-gallery.html`);

const MODULES = [
  ['notes', 'Notes'],
  ['todos', 'Todos'],
  ['meals', 'Meals'],
  ['pomodoro', 'Pomodoro'],
  ['shared', 'Shared'],
];

const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, 'utf8'))
  : null;
const screens = manifest?.screens ?? [];
const okCount = screens.filter((screen) => screen.status === 'ok').length;
const failedCount = screens.length - okCount;

/** Every value here arrives from the manifest, so none of it is trusted markup. */
function escape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** `2026-10-29T12:20:36.412Z` → `2026-10-29 12:20 UTC`; keeps the page script-free. */
function stamp(iso) {
  return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : 'unknown';
}

function meta(screen, manifest) {
  return `<p class="meta"><span class="route">${escape(screen.route)}</span> · ${escape(screen.file)} · ${escape(stamp(manifest.capturedAt))}</p>`;
}

/**
 * One theme's row inside a screen card. A theme that failed keeps its row and
 * states the reason, so a card never shows a dark shot with the light one missing.
 */
function themeRow(screen, manifest) {
  const label = `<p class="theme">${escape(screen.theme ?? 'theme not recorded')}</p>`;
  if (screen.status !== 'ok') {
    // An empty frame reads as a broken page rather than a missing capture.
    return `<div class="row failed">
      ${label}
      <p class="failure"><strong>Not captured.</strong> ${escape(screen.reason ?? 'reason not recorded')}</p>
      ${meta(screen, manifest)}
    </div>`;
  }
  return `<div class="row">
    ${label}
    <a class="shot" href="${escape(screensName)}/${escape(screen.file)}" title="Open ${escape(screen.file)} full size">
      <img src="${escape(screensName)}/${escape(screen.file)}" width="${manifest.viewport.width}" height="${manifest.viewport.height}" loading="lazy"
        alt="${escape(screen.title)} screen at ${escape(screen.route)}, ${escape(screen.theme ?? 'default')} theme">
    </a>
    ${meta(screen, manifest)}
  </div>`;
}

/** One card per screen, holding the same route's row for every theme it was shot in. */
function screenCard(group) {
  const [first] = group;
  return `<article class="tile">
    <h3>${escape(first.title)}</h3>
    ${group.map((screen) => themeRow(screen, manifest)).join('\n')}
  </article>`;
}

function section([key, label], group) {
  return `<section aria-labelledby="module-${key}">
    <h2 id="module-${key}">${escape(label)} <span class="count">${group.length}</span></h2>
    <div class="tiles">${group.map(screenCard).join('\n')}</div>
  </section>`;
}

// The manifest is a flat list of captures; one card per slug keeps a screen's
// themes together however many there are.
const bySlug = new Map();
for (const screen of screens) {
  if (!bySlug.has(screen.slug)) bySlug.set(screen.slug, []);
  bySlug.get(screen.slug).push(screen);
}

const byModule = new Map();
for (const group of bySlug.values()) {
  const module = group[0].module;
  if (!byModule.has(module)) byModule.set(module, []);
  byModule.get(module).push(group);
}
const themesSeen = [...new Set(screens.map((screen) => screen.theme).filter(Boolean))];
const known = new Set(MODULES.map(([key]) => key));
// Fixed order for the five app modules; anything unrecognised keeps its own
// section afterwards instead of being dropped.
const ordered = [
  ...MODULES.filter(([key]) => byModule.has(key)),
  ...[...byModule.keys()].filter((key) => !known.has(key)).map((key) => [key, key]),
];

const summary = manifest
  ? `<dl class="facts">
      <div><dt>Total</dt><dd>${screens.length}</dd></div>
      <div><dt>Captured</dt><dd>${okCount}</dd></div>
      <div><dt>Failed</dt><dd>${failedCount}</dd></div>
      <div><dt>Screens</dt><dd>${bySlug.size}</dd></div>
      <div><dt>Themes</dt><dd>${escape(themesSeen.join(', ') || 'not recorded')}</dd></div>
      <div><dt>Viewport</dt><dd>${manifest.viewport.width}×${manifest.viewport.height} CSS px @${manifest.viewport.dpr}x</dd></div>
      <div><dt>Git SHA</dt><dd class="mono">${escape(manifest.gitSha || 'unknown')}</dd></div>
      <div><dt>Captured at</dt><dd>${escape(stamp(manifest.capturedAt))}</dd></div>
    </dl>`
  : '';

const body = screens.length
  ? `<p class="note">Capture at ${manifest.viewport.width}×${manifest.viewport.height} CSS px, device pixel ratio
      ${manifest.viewport.dpr}. Regenerate after UI changes with
      <code>npm run screens -w apps/app</code> against a dev server on port 3100.</p>
    <label class="filter">Filter <input type="search" id="filter" placeholder="route, title or slug" autocomplete="off"></label>
    ${ordered.map((entry) => section(entry, byModule.get(entry[0]) ?? [])).join('\n')}`
  : `<div class="empty">
      <h2>No captures yet</h2>
      <p>Start the app on port 3100 (<code>npm run dev</code>), then run:</p>
      <pre><code>npm run screens -w apps/app</code></pre>
      <p class="note">This page is regenerated from <code>${escape(screensName)}/manifest.json</code>; reload it after the capture run.</p>
    </div>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Personal Life — screen gallery</title>
<style>
  /* Every value below is a token from docs/design-systems/personal-life/DESIGN.md
     (dark palette); keep the gallery and the app on one set of numbers. */
  :root {
    color-scheme: dark;
    --bg: #0f1115;
    --panel: #181b22;
    --text: #e8eaf0;
    --muted: #8b93a7;
    --accent: #5b8cff;
    --border: #2a2f3a;
    --danger: #ff6b6b;
    --radius-md: 10px;
    --radius-lg: 12px;
    --font: system-ui, -apple-system, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
    --phone-w: 414;
    --phone-h: 896;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0 auto;
    padding: 2rem 1rem 4rem;
    max-width: 72rem;
    background: var(--bg);
    color: var(--text);
    font: 16px/1.5 var(--font);
  }

  h1 { font-size: 1.75rem; line-height: 1.25; margin: 0 0 0.5rem; }
  h2 { font-size: 1.25rem; line-height: 1.25; margin: 2rem 0 0.75rem; padding-top: 0.5rem; border-top: 1px solid var(--border); }
  h3 { font-size: 1rem; line-height: 1.25; margin: 0 0 0.25rem; }

  a { color: var(--accent); }
  a:hover { text-decoration: underline; }

  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }

  p { margin: 0.25rem 0; }
  .note { color: var(--muted); font-size: 0.9375rem; }
  .mono { font-family: var(--mono); font-size: 0.875rem; }

  code {
    font-family: var(--mono);
    font-size: 0.875em;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.05em 0.3em;
  }
  pre { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 0.75rem 1rem; overflow-x: auto; }
  pre code { background: none; border: 0; padding: 0; }

  .facts { display: flex; flex-wrap: wrap; gap: 0.75rem 1.5rem; margin: 1rem 0; padding: 0.75rem 1rem; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-lg); }
  .facts div { margin: 0; }
  .facts dt { color: var(--muted); font-size: 0.8125rem; }
  .facts dd { margin: 0; font-weight: 600; }

  .count { color: var(--muted); font-weight: 400; font-size: 0.9375rem; }

  .filter { display: flex; align-items: center; gap: 0.5rem; margin: 1rem 0; color: var(--muted); }
  .filter input { font: inherit; color: var(--text); background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 0.4rem 0.625rem; min-width: 18rem; }
  /* Full-opacity muted, not the browser's faded default: #8b93a7 on #181b22 is 5.60:1. */
  .filter input::placeholder { color: var(--muted); opacity: 1; }

  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 1.25rem; }

  .tile { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 0.75rem; }
  .tile[hidden] { display: none; }

  /* Each theme is its own labelled row; the label is what makes a light shot
     next to a dark one readable without opening the file name. */
  .row { margin-bottom: 0.75rem; }
  .row:last-child { margin-bottom: 0; }
  .theme { color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.25rem; }

  /* Natural flow at the PNG's own ratio: the full screen stays visible however
     narrow the column gets, never cropped to a different aspect. */
  .shot { display: block; margin-bottom: 0.5rem; }
  .shot img {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: var(--phone-w) / var(--phone-h);
    object-fit: contain;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .meta { color: var(--muted); font-size: 0.8125rem; font-family: var(--mono); overflow-wrap: anywhere; }
  .route { color: var(--text); }

  .row.failed { border: 1px solid var(--danger); border-radius: var(--radius-md); padding: 0.5rem 0.75rem; }
  .failure { color: var(--danger); font-size: 0.9375rem; overflow-wrap: anywhere; }

  .empty { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1rem 1.25rem; margin-top: 1.5rem; }
  .empty h2 { border: 0; margin-top: 0; padding-top: 0; }

  @media print {
    :root { color-scheme: light; --bg: #ffffff; --panel: #ffffff; --text: #000000; --muted: #333333; --accent: #000000; --border: #999999; --danger: #000000; }
    body { max-width: none; padding: 0; background: #ffffff; color: #000000; }
    .filter { display: none; }
    .tiles { grid-template-columns: repeat(2, 1fr); gap: 0.75rem; }
    .tile, .shot, .shot img { break-inside: avoid; page-break-inside: avoid; }
    .shot img { border-color: #999999; }
  }
</style>
</head>
<body>
<header>
  <h1>Personal Life — screen gallery</h1>
  ${summary}
</header>
${body}
<script>
  // Progressive: without this script every tile stays visible, because hiding is
  // done with the HTML "hidden" attribute, never by the markup itself.
  (function () {
    var input = document.getElementById('filter');
    if (!input) return;
    var tiles = Array.prototype.slice.call(document.querySelectorAll('.tile'));
    input.addEventListener('input', function () {
      var query = input.value.trim().toLowerCase();
      tiles.forEach(function (tile) {
        tile.hidden = query !== '' && tile.textContent.toLowerCase().indexOf(query) === -1;
      });
    });
  })();
</script>
</body>
</html>
`;

mkdirSync(dirname(galleryPath), { recursive: true });
writeFileSync(galleryPath, html);
console.log(
  screens.length
    ? `gallery: ${bySlug.size} screens, ${screens.length} captures (${okCount} captured, ${failedCount} failed) → ${galleryPath}`
    : `gallery: no captures yet → ${galleryPath}`,
);
