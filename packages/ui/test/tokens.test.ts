import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FEEDBACK_STATUSES } from '../src/components/feedback-status';

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

/** §2 light palette plus §3's on-accent word, as declared on `:root`. */
const LIGHT_COLORS = {
  '--page': '#f4f4f1',
  '--surface': '#ffffff',
  '--surface-sunken': '#f7f7f4',
  '--press': '#ecece9',
  '--ink': '#1b1b1f',
  '--ink-2': '#58585e',
  '--ink-3': '#63636a',
  '--line': 'rgba(0, 0, 0, 0.08)',
  '--line-strong': '#8a8a8a',
  '--focus': '#2a5d8f',
  '--ok': '#335b3f',
  '--ok-soft': '#eaf1ea',
  '--warn': '#6e5a16',
  '--warn-soft': '#f5f0e0',
  '--danger': '#8a3b3b',
  '--danger-soft': '#f6e9e9',
  '--chart-muted': '#c9c9c6',
  '--on-max': '#ffffff',
} as const;

/** §2 dark palette plus §3's on-accent word. */
const DARK_COLORS = {
  '--page': '#16171a',
  '--surface': '#1e2024',
  '--surface-sunken': '#24262b',
  '--press': '#2c2f35',
  '--ink': '#e9e7e2',
  '--ink-2': '#a9a79f',
  '--ink-3': '#96948d',
  '--line': 'rgba(255, 255, 255, 0.07)',
  '--line-strong': '#767b84',
  '--focus': '#8fbce8',
  '--ok': '#9fc0a3',
  '--ok-soft': '#202a21',
  '--warn': '#d9c68a',
  '--warn-soft': '#2a2418',
  '--danger': '#d98c86',
  '--danger-soft': '#2c1f1f',
  '--chart-muted': '#3a3d43',
  '--on-max': '#16171a',
} as const;

/** §3 one accent per app: `[fill, pressed fill]` per scheme. */
const ACCENTS = {
  notes: { light: ['#4f6b52', '#405743'], dark: ['#9fc0a3', '#b0cdb3'] },
  todos: { light: ['#2f5f61', '#254b4d'], dark: ['#82b5b6', '#97c5c6'] },
  meals: { light: ['#8b5a45', '#744a38'], dark: ['#dca489', '#e4b39c'] },
  pomodoro: { light: ['#5a5285', '#4a4470'], dark: ['#b6aedc', '#c7c1e6'] },
  feedback: { light: ['#6f5570', '#5b455c'], dark: ['#c4a9c6', '#d0bacf'] },
} as const;

/** §4 one stack, eleven declared steps, two read-outs. */
const TYPE_TOKENS = {
  '--font-stack': "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
  '--fs-title': '28px',
  '--fs-sheet-title': '20px',
  '--fs-body': '17px',
  '--fs-row-title': '16px',
  '--fs-button': '16px',
  '--fs-chip': '15px',
  '--fs-label': '14px',
  '--fs-meta': '13.5px',
  '--fs-section-label': '13px',
  '--fs-pill': '12.5px',
  '--fs-count': '12px',
  '--fs-axis': '11px',
  '--fs-kpi': '40px',
  '--fs-timer': '64px',
  '--lh-title': '1.14',
  '--lh-sheet-title': '1.25',
  '--lh-body': '1.47',
  '--lh-body-longform': '1.55',
  '--lh-row-title': '1.35',
  '--lh-control': '1',
  '--lh-meta': '1.4',
  '--lh-kpi': '1.05',
  '--fw-body': '400',
  '--fw-semibold': '600',
  '--fw-section-label': '650',
  '--fw-bold': '700',
  '--tracking-title': '-0.021em',
  '--tracking-sheet-title': '-0.015em',
  '--tracking-row-title': '-0.008em',
  '--tracking-button': '-0.005em',
  '--tracking-section-label': '0.06em',
  '--tracking-pill': '0.005em',
  '--tracking-count': '0.02em',
  '--tracking-kpi': '-0.03em',
  '--tracking-timer': '-0.04em',
  '--tracking-none': '0',
} as const;

/** §5 seven 4px steps, the frame, and the touch minimum. */
const SPACE_TOKENS = {
  '--s1': '4px',
  '--s2': '8px',
  '--s3': '12px',
  '--s4': '16px',
  '--s5': '20px',
  '--s6': '24px',
  '--s8': '32px',
  '--frame-max': '414px',
  '--tap': '48px',
  '--row-min-height': '56px',
  '--checkbox-size': '24px',
  /* §6's corner for the mark, an alias of `--r-sm` so a row can narrow it with the size. */
  '--checkbox-radius': 'var(--r-sm)',
  '--fab-size': '56px',
} as const;

/** §6 four radii, two border widths, the focus ring — and no product shadow. */
const SHAPE_TOKENS = {
  '--r-sm': '8px',
  '--r-md': '12px',
  '--r-lg': '16px',
  '--r-pill': '999px',
  '--border-width': '1px',
  '--border-width-strong': '1.5px',
  '--focus-ring': '2px',
} as const;

/** §7 two durations on one curve. */
const MOTION_TOKENS = {
  '--d-fast': '200ms',
  '--d-base': '260ms',
  '--ease': 'cubic-bezier(0.25, 1, 0.5, 1)',
} as const;

/** §8 the scrim's dim: one value in both schemes, because it dims toward black. */
const SCRIM_TOKENS = {
  '--scrim': 'rgba(0, 0, 0, 0.32)',
} as const;

/** Every distinct px literal the whole refactor is allowed to know about. */
const FROZEN_PX = [
  '1px', '1.5px', '2px', '4px', '8px', '11px', '12px', '12.5px', '13px', '13.5px',
  '14px', '15px', '16px', '17px', '20px', '24px', '28px', '32px', '40px', '48px',
  '56px', '64px', '414px', '999px',
];

/**
 * The app-wide breakpoint scale (Tailwind's published values). This map is the
 * single owner of the five values: media queries cannot read custom properties
 * and re-listing the literals in `tokens.css` would break the frozen px
 * inventory, so a component's `@media` literal is checked against this map
 * instead of against a duplicate comment.
 */
const BREAKPOINTS = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
} as const;

/** The revised palette's status hues, in the order `feedback-status.ts` maps them. */
const REVISED_STATUS_HUES = ['--ink-2', '--warn', '--ok', '--ink-3'] as const;

describe('tokens.css — palette and schemes', () => {
  const tokens = read('src/styles/tokens.css');

  it('paints the light scheme on :root, so it is light by definition', () => {
    const decls = declarations(tokens, ':root');
    expect(decls).toMatchObject(LIGHT_COLORS);
    expect(decls['color-scheme']).toBe('light');
  });

  it("paints the dark scheme on :root[data-theme='dark']", () => {
    const decls = declarations(tokens, ":root[data-theme='dark']");
    expect(decls).toMatchObject(DARK_COLORS);
    expect(decls['color-scheme']).toBe('dark');
  });

  it('restates the dark scheme for System under prefers-color-scheme: dark', () => {
    const system = tokens.slice(tokens.indexOf('@media (prefers-color-scheme: dark)'));
    expect(system).not.toBe('');
    const decls = declarations(system, ':root:not([data-theme])');
    expect(decls).toMatchObject(DARK_COLORS);
    expect(decls['color-scheme']).toBe('dark');
  });
});

describe('tokens.css — one accent per app', () => {
  const tokens = read('src/styles/tokens.css');
  const system = tokens.slice(tokens.indexOf('@media (prefers-color-scheme: dark)'));

  it.each(Object.entries(ACCENTS))('paints %s in light', (app, accent) => {
    expect(declarations(tokens, `[data-app='${app}']`)).toMatchObject({
      '--max': accent.light[0],
      '--max-press': accent.light[1],
    });
  });

  it.each(Object.entries(ACCENTS))('repaints %s for an explicit dark choice', (app, accent) => {
    expect(declarations(tokens, `[data-theme='dark'] [data-app='${app}']`)).toMatchObject({
      '--max': accent.dark[0],
      '--max-press': accent.dark[1],
    });
  });

  it.each(Object.entries(ACCENTS))('repaints %s when the system is dark', (app, accent) => {
    expect(declarations(system, `:root:not([data-theme]) [data-app='${app}']`)).toMatchObject({
      '--max': accent.dark[0],
      '--max-press': accent.dark[1],
    });
  });
});

describe('tokens.css — type, rhythm, shape and motion', () => {
  const tokens = read('src/styles/tokens.css');

  it('declares the type scale at the revised values', () => {
    expect(declarations(tokens, ':root')).toMatchObject(TYPE_TOKENS);
  });

  it('declares the spacing rhythm and the layout measures', () => {
    expect(declarations(tokens, ':root')).toMatchObject(SPACE_TOKENS);
  });

  it('declares the radii, the border widths and the focus ring', () => {
    expect(declarations(tokens, ':root')).toMatchObject(SHAPE_TOKENS);
  });

  it('declares both durations on the one curve', () => {
    expect(declarations(tokens, ':root')).toMatchObject(MOTION_TOKENS);
  });

  it('declares one scrim dim, shared by both schemes', () => {
    expect(declarations(tokens, ':root')).toMatchObject(SCRIM_TOKENS);
  });
});

describe('tokens.css — vocabulary the revision forbids', () => {
  const tokens = read('src/styles/tokens.css');

  it('carries no gradient', () => {
    expect(tokens).not.toMatch(/gradient/i);
  });

  it('carries no shadow token at all, let alone an elevation ladder', () => {
    expect(tokens).not.toMatch(/box-shadow|--shadow/);
  });

  it('carries exactly the four ladder radii, no invented step', () => {
    expect(tokens.match(/--r-[a-z]+:/g)).toEqual(['--r-sm:', '--r-md:', '--r-lg:', '--r-pill:']);
  });

  it('carries one on-accent word per scheme and no second value', () => {
    const declared = tokens.match(/--on-max:/g) ?? [];
    expect(declared).toHaveLength(3);
    expect(new Set([LIGHT_COLORS['--on-max'], DARK_COLORS['--on-max']]).size).toBe(2);
  });

  it('keeps the app-wide breakpoint scale out of the token declarations', () => {
    for (const name of Object.keys(BREAKPOINTS)) {
      expect(tokens).not.toMatch(new RegExp(`--${name}\\s*:`));
    }
  });

  it('uses exactly the frozen px inventory, no invented value', () => {
    expect(unitValues(tokens, 'px').sort()).toEqual([...FROZEN_PX].sort());
  });

  it('uses the em scale for tracking and no rem literal at all', () => {
    expect(unitValues(tokens, 'rem')).toEqual([]);
  });
});

describe('feedback status → revised token', () => {
  const tokensCss = read('src/styles/tokens.css');

  it('pins every status to its revised hue', () => {
    const hues = FEEDBACK_STATUSES.map(({ token }) => token);
    expect(hues).toEqual([...REVISED_STATUS_HUES]);
  });

  it('reads four distinct tokens declared in tokens.css', () => {
    const decls = declarations(tokensCss, ':root');
    for (const hue of REVISED_STATUS_HUES) expect(decls[hue]).toBeDefined();
    expect(new Set(REVISED_STATUS_HUES).size).toBe(4);
  });
});

describe('base.css — base element layer', () => {
  const base = read('src/styles/base.css');

  it('owns the universal box-sizing rule', () => {
    const decls = declarations(base, '*');
    expect(decls['box-sizing']).toBe('border-box');
  });

  it('owns the body reset: the ground, the ink and the §4 type baseline, all from tokens', () => {
    const decls = declarations(base, 'body');
    expect(decls['margin']).toBe('0');
    expect(decls['padding']).toBe('0');
    expect(decls['background']).toBe('var(--page)');
    expect(decls['color']).toBe('var(--ink)');
    expect(decls['font-family']).toBe('var(--font-stack)');
    expect(decls['font-size']).toBe('var(--fs-body)');
    expect(decls['font-weight']).toBe('var(--fw-body)');
    expect(decls['line-height']).toBe('var(--lh-body)');
  });

  it('leaves the root font-size to the UA, so every rem-based utility keeps its px', () => {
    const decls = declarations(base, 'html');
    expect(decls['-webkit-text-size-adjust']).toBe('100%');
    expect(decls['font-size']).toBeUndefined();
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
