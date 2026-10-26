// Generates each route's PWA icon (512x512 PNG): a full-bleed solid background
// with a centred white Lucide glyph. Run from the repo root:
//
//   node apps/app/scripts/generate-icons.mjs

import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// `sharp` is a hoisted transitive dependency (Next's own rasteriser, resolves at the
// repo root); it is the only rasteriser present, so it is used as-is.
import sharp from 'sharp';

const SIZE = 512;
const GLYPH_BOX = 24; // Lucide's native coordinate space
const GLYPH_SCALE = 12; // 24 units -> 288px box, glyph ≈240px with icon padding
const GLYPH_OFFSET = (SIZE - GLYPH_BOX * GLYPH_SCALE) / 2; // 112px on each axis
const STROKE_WIDTH = 8 / 3; // ≈2.67 units -> ≈32px after the 12x scale

const ICONS = [
  { file: 'icon-notes.png', color: '#5b8cff', icon: 'text-align-start' },
  { file: 'icon-todos.png', color: '#34c759', icon: 'check' },
  { file: 'icon-meals.png', color: '#ff9500', icon: 'utensils' },
  { file: 'icon-feedback.png', color: '#af52de', icon: 'message-square-text' },
  { file: 'icon-pomodoro.png', color: '#ff3b30', icon: 'hourglass' },
];

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

async function loadGlyphNodes(iconName) {
  const { __iconData } = await import(`lucide-react/dist/esm/icons/${iconName}.mjs`);
  return __iconData.node;
}

function renderNode([type, attrs]) {
  if (type !== 'path') {
    throw new Error(`Unsupported Lucide node type "${type}" in glyph`);
  }
  return `<path d="${attrs.d}"/>`;
}

function buildSvg(color, nodes) {
  const glyph = nodes.map(renderNode).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
    <rect width="${SIZE}" height="${SIZE}" fill="${color}"/>
    <g transform="translate(${GLYPH_OFFSET} ${GLYPH_OFFSET}) scale(${GLYPH_SCALE})"
       fill="none" stroke="#fff" stroke-width="${STROKE_WIDTH}"
       stroke-linecap="round" stroke-linejoin="round">${glyph}</g>
  </svg>`;
}

async function writeIcon({ file, color, icon }) {
  const nodes = await loadGlyphNodes(icon);
  const path = join(publicDir, file);
  await sharp(Buffer.from(buildSvg(color, nodes)))
    .png()
    .toFile(path);
  console.log(`${file} ${color} ${icon} ${statSync(path).size} bytes`);
}

await Promise.all(ICONS.map((route) => writeIcon(route)));
