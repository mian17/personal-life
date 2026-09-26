import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');

function read(rel: string): string {
  try {
    return readFileSync(join(root, rel), 'utf8');
  } catch {
    return '';
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Remove `/* ... *\/` comments so declarations parse cleanly. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Return the raw declaration body of the first block matching `selector`. */
function blockBody(css: string, selector: string): string {
  const match = css.match(new RegExp(escapeRegExp(selector) + '\\s*\\{([^}]*)\\}'));
  if (!match) {
    throw new Error(`CSS block not found: ${selector}`);
  }
  return match[1];
}

/** Parse a selector block into a `--token` -> value map. */
function declarations(css: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of stripComments(blockBody(css, selector)).split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    out[trimmed.slice(0, colon).trim()] = trimmed.slice(colon + 1).trim();
  }
  return out;
}

/** Distinct `<number><unit>` literals used anywhere in a stylesheet. */
function unitValues(css: string, unit: 'px' | 'rem'): string[] {
  const found = css.match(new RegExp(`(?:\\d*\\.\\d+|\\d+)\\.?\\d*${unit}`, 'g')) ?? [];
  return Array.from(new Set(found));
}

/** Frozen colors — byte-identical to apps/app/app/globals.css. */
const DARK_COLORS = {
  '--bg': '#0f1115',
  '--panel': '#181b22',
  '--text': '#e8eaf0',
  '--muted': '#8b93a7',
  '--accent': '#5b8cff',
  '--danger': '#ff6b6b',
  '--border': '#2a2f3a',
} as const;

const LIGHT_COLORS = {
  '--bg': '#f4f5f7',
  '--panel': '#ffffff',
  '--text': '#1a1d24',
  '--muted': '#5c6577',
  '--accent': '#2f6bff',
  '--danger': '#d64545',
  '--border': '#dfe3ea',
} as const;

/** Literals promoted to named tokens — values unchanged. */
const NAMED_TOKENS = {
  '--radius-md': '10px',
  '--radius-lg': '12px',
  '--radius-pill': '999px',
  '--tap-height': '48px',
  '--content-width': '640px',
  '--border-width': '1px',
  '--focus-ring': '2px',
  '--icon-btn-size': '40px',
  '--fab-size': '56px',
  '--font-size': '16px',
  '--leading': '1.5',
  '--fs-editor': '1.05rem',
  '--shadow-fab': '0 4px 12px rgba(0, 0, 0, 0.25)',
  '--font-stack': 'system-ui, -apple-system, sans-serif',
} as const;

/** Spacing scale — exactly the 20 distinct rem literals in globals.css. */
const SPACING_REM = {
  '--space-0-15': '0.15rem',
  '--space-0-2': '0.2rem',
  '--space-0-25': '0.25rem',
  '--space-0-3': '0.3rem',
  '--space-0-35': '0.35rem',
  '--space-0-4': '0.4rem',
  '--space-0-5': '0.5rem',
  '--space-0-6': '0.6rem',
  '--space-0-7': '0.7rem',
  '--space-0-75': '0.75rem',
  '--space-0-8': '0.8rem',
  '--space-0-85': '0.85rem',
  '--space-0-9': '0.9rem',
  '--space-0-95': '0.95rem',
  '--space-1': '1rem',
  '--space-1-25': '1.25rem',
  '--space-2': '2rem',
  '--space-3': '3rem',
  '--space-5': '5rem',
} as const;

const FROZEN_REM = [
  '0.15rem', '0.2rem', '0.25rem', '0.3rem', '0.35rem', '0.4rem', '0.5rem', '0.6rem',
  '0.7rem', '0.75rem', '0.8rem', '0.85rem', '0.9rem', '0.95rem', '1rem', '1.05rem',
  '1.25rem', '2rem', '3rem', '5rem',
];

const FROZEN_PX = ['1px', '2px', '4px', '10px', '12px', '16px', '40px', '48px', '56px', '640px', '999px'];

describe('tokens.css — frozen token contract', () => {
  const tokens = read('src/styles/tokens.css');

  it('pins the dark defaults on :root, byte-identical to globals.css', () => {
    const decls = declarations(tokens, ':root');
    expect(decls).toMatchObject(DARK_COLORS);
    expect(decls['color-scheme']).toBe('light dark');
  });

  it("pins the dark theme block on :root[data-theme='dark']", () => {
    const decls = declarations(tokens, ":root[data-theme='dark']");
    expect(decls['color-scheme']).toBe('dark');
  });

  it("pins the light theme block on :root[data-theme='light']", () => {
    const decls = declarations(tokens, ":root[data-theme='light']");
    expect(decls).toMatchObject(LIGHT_COLORS);
    expect(decls['color-scheme']).toBe('light');
  });

  it('defines every promoted named token at the exact literal value', () => {
    const decls = declarations(tokens, ':root');
    expect(decls).toMatchObject(NAMED_TOKENS);
  });

  it('defines the spacing scale at exactly the frozen rem values', () => {
    const decls = declarations(tokens, ':root');
    expect(decls).toMatchObject(SPACING_REM);
  });

  it('keeps the four theme selectors with the light/dark/media shape', () => {
    expect(tokens).toContain(":root[data-theme='dark']");
    expect(tokens).toContain(":root[data-theme='light']");
    expect(tokens).toContain('@media (prefers-color-scheme: light)');
    expect(tokens).toContain(':root:not([data-theme])');
  });

  it('applies the light palette inside the prefers-color-scheme media query', () => {
    const mediaAt = tokens.indexOf('@media (prefers-color-scheme: light)');
    const notRootAt = tokens.indexOf(':root:not([data-theme])');
    expect(mediaAt).toBeGreaterThanOrEqual(0);
    expect(notRootAt).toBeGreaterThan(mediaAt);
    const decls = declarations(tokens.slice(notRootAt), ':root:not([data-theme])');
    expect(decls).toMatchObject(LIGHT_COLORS);
  });

  it('uses exactly the frozen rem inventory, no invented values', () => {
    expect(unitValues(tokens, 'rem').sort()).toEqual([...FROZEN_REM].sort());
  });

  it('uses exactly the frozen px inventory, no invented values', () => {
    expect(unitValues(tokens, 'px').sort()).toEqual([...FROZEN_PX].sort());
  });
});

describe('base.css — base element layer', () => {
  const base = read('src/styles/base.css');

  it('owns the universal box-sizing rule', () => {
    const decls = declarations(base, '*');
    expect(decls['box-sizing']).toBe('border-box');
  });

  it('owns the html, body reset with values from tokens only', () => {
    const decls = declarations(base, 'html,\nbody');
    expect(decls['margin']).toBe('0');
    expect(decls['padding']).toBe('0');
    expect(decls['background']).toBe('var(--bg)');
    expect(decls['color']).toBe('var(--text)');
    expect(decls['font']).toBe('var(--font-size)/var(--leading) var(--font-stack)');
  });
});

describe('styles.css — single consumer entry', () => {
  const entry = read('src/styles.css');

  it('imports tokens.css then base.css in that order', () => {
    const tokensAt = entry.indexOf('./styles/tokens.css');
    const baseAt = entry.indexOf('./styles/base.css');
    expect(tokensAt).toBeGreaterThanOrEqual(0);
    expect(baseAt).toBeGreaterThanOrEqual(0);
    expect(tokensAt).toBeLessThan(baseAt);
  });
});
