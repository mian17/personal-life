/**
 * Proves the §1 theme plumbing the whole revision rests on: every colour role declared in
 * `tokens.css` resolves to its revised literal in light and in dark, the explicit `data-theme`
 * choice and the no-attribute System path carry the same dark set, each app's accent stays
 * inside its own scope, and `theme.css` exposes that vocabulary to Tailwind without naming a
 * role `tokens.css` does not declare.
 *
 * The stylesheets are read as text rather than through the CSSOM: jsdom drops the
 * `@media (prefers-color-scheme: dark)` block, which is exactly the System path under test.
 * The same reading pins the §7 motion gate in `base.css`, and the last two groups read the
 * app's own sources so the copies of the theme vocabulary that live outside this package
 * cannot drift from the one `tokens.css` declares.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const STYLES_DIRECTORY = join(__dirname, '../src/styles');
const COMPONENTS_DIRECTORY = join(__dirname, '../src/components');
const TOKENS_CSS = readFileSync(join(STYLES_DIRECTORY, 'tokens.css'), 'utf8');
const THEME_CSS = readFileSync(join(STYLES_DIRECTORY, 'theme.css'), 'utf8');
const BASE_CSS = readFileSync(join(STYLES_DIRECTORY, 'base.css'), 'utf8');
/** The app's pre-paint script: the other half of the storage key. */
const APP_LAYOUT = readFileSync(join(__dirname, '../../../apps/app/app/layout.tsx'), 'utf8');
/**
 * Every area layout, concatenated: the accent scope moved off the root script and onto each
 * segment's own layout, so the scopes the app paints are declared here (one `app="…"` per area).
 */
const AREA_LAYOUTS = ['notes', 'todos', '(meals)/meals', 'pomodoro', 'feedback']
  .map((directory) => readFileSync(join(__dirname, '../../../apps/app/app', directory, 'layout.tsx'), 'utf8'))
  .join('\n');

const DARK_SCHEME_MEDIA = '@media (prefers-color-scheme: dark)';
const SYSTEM_ROOT_SELECTOR = ':root:not([data-theme])';

type Declarations = Record<string, string>;

const LIGHT_SCHEME: Declarations = {
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
};

const DARK_SCHEME: Declarations = {
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
};

/**
 * The half of the same bridge that no utility class can carry: `var()` reads from an SVG
 * attribute, a `calc()` in an arbitrary value, a mask gradient. A primitive that still speaks
 * one of these renders with zero padding, zero gap and zero radius once the name goes
 * undefined, so this table is a rendering criterion, not a tidiness rule. Same deletion list
 * as `RETIRED_ROLE_BRIDGES`: an entry leaves here with the last consumer's restyle.
 */
const RETIRED_VALUE_BRIDGES: Declarations = {
  '--panel': 'var(--surface)',
  '--muted': 'var(--ink-2)',
  '--accent': 'var(--max)',
  '--amber': 'var(--warn)',
  '--border': 'var(--line)',
  '--space-0-15': 'calc(var(--s1) * 0.6)',
  '--space-0-2': 'calc(var(--s1) * 0.8)',
  '--space-0-25': 'var(--s1)',
  '--space-0-3': 'calc(var(--s1) * 1.2)',
  '--space-0-35': 'calc(var(--s1) * 1.4)',
  '--space-0-4': 'calc(var(--s1) * 1.6)',
  '--space-0-5': 'var(--s2)',
  '--space-0-6': 'calc(var(--s2) * 1.2)',
  '--space-0-7': 'calc(var(--s1) * 2.8)',
  '--space-0-75': 'var(--s3)',
  '--space-0-8': 'calc(var(--s1) * 3.2)',
  '--space-0-85': 'calc(var(--s1) * 3.4)',
  '--space-0-9': 'calc(var(--s1) * 3.6)',
  '--space-0-95': 'calc(var(--s1) * 3.8)',
  '--space-1': 'var(--s4)',
  '--space-1-25': 'var(--s5)',
  '--space-2': 'var(--s8)',
  '--space-3': 'var(--tap)',
  '--space-5': 'calc(var(--s8) * 2.5)',
  '--tap-height': 'var(--tap)',
  '--content-width': 'var(--frame-max)',
  '--icon-btn-size': 'var(--tap)',
  '--radius-md': 'var(--r-md)',
  '--radius-lg': 'var(--r-lg)',
  '--radius-pill': 'var(--r-pill)',
  '--leading': 'var(--lh-row-title)',
  '--fs-editor': 'var(--fs-body)',
  '--shadow-fab': '0 0 0 0 transparent',
};

/** §3 one accent per app, for fill, selection and progress only. */
const ACCENT_ROLES = ['--max', '--max-press'];

/**
 * Names a component reads but this package never declares: Radix writes the trigger width onto
 * the element, and the autosuggest row count arrives as an inline style with its own fallback.
 * They are runtime inputs, so a missing declaration is correct for them and only for them.
 */
const RUNTIME_SUPPLIED_VALUES = ['--autosuggest-rows', '--radix-popover-trigger-width'];

/**
 * The shipped role names a primitive or a screen still speaks, each bridged in `theme.css`
 * onto the revised role that replaces it. This table is the deletion list for that bridge
 * block: an entry leaves here the day its last consumer is restyled, and the test then
 * demands the bridge leave `theme.css` too.
 */
const RETIRED_ROLE_BRIDGES: Declarations = {
  '--color-bg': 'var(--page)',
  '--color-panel': 'var(--surface)',
  '--color-text': 'var(--ink)',
  '--color-muted': 'var(--ink-2)',
  '--color-border': 'var(--line)',
  '--color-accent': 'var(--max)',
  '--color-on-accent': 'var(--on-max)',
  '--color-amber': 'var(--warn)',
  '--color-green': 'var(--ok)',
};

const APP_ACCENTS: Record<string, { light: Declarations; dark: Declarations }> = {
  notes: {
    light: { '--max': '#4f6b52', '--max-press': '#405743' },
    dark: { '--max': '#9fc0a3', '--max-press': '#b0cdb3' },
  },
  todos: {
    light: { '--max': '#2f5f61', '--max-press': '#254b4d' },
    dark: { '--max': '#82b5b6', '--max-press': '#97c5c6' },
  },
  meals: {
    light: { '--max': '#8b5a45', '--max-press': '#744a38' },
    dark: { '--max': '#dca489', '--max-press': '#e4b39c' },
  },
  pomodoro: {
    light: { '--max': '#5a5285', '--max-press': '#4a4470' },
    dark: { '--max': '#b6aedc', '--max-press': '#c7c1e6' },
  },
  feedback: {
    light: { '--max': '#6f5570', '--max-press': '#5b455c' },
    dark: { '--max': '#c4a9c6', '--max-press': '#d0bacf' },
  },
};

describe('the light scheme', () => {
  it('declares every revised colour role on :root with its frozen literal', () => {
    expect(declarationsOf(TOKENS_CSS, ':root')).toMatchObject(LIGHT_SCHEME);
  });

  it('paints a raised surface above the ground it sits on', () => {
    const light = declarationsOf(TOKENS_CSS, ':root');
    expect(relativeLuminance(light['--surface'])).toBeGreaterThan(relativeLuminance(light['--page']));
  });
});

describe('the dark scheme', () => {
  it('declares every revised colour role under data-theme="dark" with its frozen literal', () => {
    expect(declarationsOf(TOKENS_CSS, ":root[data-theme='dark']")).toMatchObject(DARK_SCHEME);
  });

  it('differs from light in every role, so the two schemes cannot drift into one', () => {
    const sharedRoles = Object.keys(LIGHT_SCHEME).filter((role) => LIGHT_SCHEME[role] === DARK_SCHEME[role]);
    expect(sharedRoles).toEqual([]);
  });

  it('keeps the raised surface above the ground, so the layering survives the flip', () => {
    const dark = declarationsOf(TOKENS_CSS, ":root[data-theme='dark']");
    expect(relativeLuminance(dark['--surface'])).toBeGreaterThan(relativeLuminance(dark['--page']));
  });
});

describe('the System choice', () => {
  it('restates the whole dark set when no theme attribute is chosen', () => {
    const system = systemScheme();
    expect(system).toMatchObject(DARK_SCHEME);
  });

  it('is the only path that consults the OS, so an explicit choice always wins', () => {
    expect(TOKENS_CSS).toContain(DARK_SCHEME_MEDIA);
    expect(declarationsOf(TOKENS_CSS, ':root')).toMatchObject(LIGHT_SCHEME);
  });
});

describe.each(Object.keys(APP_ACCENTS))('the %s accent', (app) => {
  it('is declared inside its own scope in light, never on :root', () => {
    expect(declarationsOf(TOKENS_CSS, `[data-app='${app}']`)).toEqual(APP_ACCENTS[app].light);
    expect(declarationsOf(TOKENS_CSS, ':root')['--max']).toBeUndefined();
  });

  it('follows the chosen dark scheme under data-theme="dark"', () => {
    expect(declarationsOf(TOKENS_CSS, `[data-theme='dark'] [data-app='${app}']`)).toEqual(APP_ACCENTS[app].dark);
  });

  it('follows the OS under System', () => {
    expect(declarationsOf(systemStylesheet(), `${SYSTEM_ROOT_SELECTOR} [data-app='${app}']`)).toEqual(
      APP_ACCENTS[app].dark,
    );
  });
});

describe('theme.css', () => {
  it('maps every revised colour role to a var() over tokens.css', () => {
    expect(tailwindColourRoles()).toEqual({ ...expectedTailwindRoles(), ...RETIRED_ROLE_BRIDGES });
  });

  it('bridges every retired role onto a role tokens.css actually declares', () => {
    const declaredRoles = new Set([...Object.keys(LIGHT_SCHEME), ...ACCENT_ROLES]);
    const unknownTargets = Object.values(RETIRED_ROLE_BRIDGES)
      .map(bridgedRole)
      .filter((role) => !declaredRoles.has(role));

    expect(unknownTargets).toEqual([]);
  });

  it('fails rather than defaults when asked for a role it does not map', () => {
    expect(() => tailwindColourRole('--unmapped')).toThrow(/theme.css does not map --unmapped/);
  });
});

describe('the retired value bridge', () => {
  it('declares every retired geometry and directly-read role on :root as a revised alias', () => {
    expect(declarationsOf(THEME_CSS, ':root')).toMatchObject(RETIRED_VALUE_BRIDGES);
  });

  it('leaves no name undefined that a component reads through var()', () => {
    const declared = new Set([
      ...Object.keys(declarationsOf(TOKENS_CSS, ':root')),
      ...Object.keys(declarationsOf(THEME_CSS, ':root')),
    ]);
    const undefinedNames = referencedValues(componentSources())
      .filter((name) => !declared.has(name) && !RUNTIME_SUPPLIED_VALUES.includes(name))
      .sort();

    expect(undefinedNames).toEqual([]);
  });
});

describe('the §4 type baseline', () => {
  /**
   * The baseline belongs to `body`, not to `html`: the root font-size is the unit the whole
   * Tailwind scale is written in, so moving it to 17px would rescale every rem-based utility
   * by 6.25% and shrink `h-12` from the 48px tap target to 51px. The revised reset splits the
   * same way — `html` takes the text-size-adjust, `body` takes the type.
   */
  it('lands on body alone, so the root font-size stays at the UA default', () => {
    expect(ruleBody(BASE_CSS, 'html')).toContain('-webkit-text-size-adjust: 100%');
    expect(ruleBody(BASE_CSS, 'html')).not.toContain('font-size');
    expect(ruleBody(BASE_CSS, 'body')).toContain('font-size: var(--fs-body)');
    expect(ruleBody(BASE_CSS, 'body')).toContain('line-height: var(--lh-body)');
  });

  it('gives every number that changes a fixed-width digit', () => {
    expect(ruleBody(BASE_CSS, 'body')).toContain('font-variant-numeric: tabular-nums');
  });
});

describe('the motion policy', () => {
  /**
   * §7 motion is opt-in, and every `transition-*` utility in `packages/ui` carries the
   * `motion-safe:` variant, so its compiled declaration sits inside a `no-preference` query.
   * That gate is what supplies the two durations: `--d-fast` for the ordinary transitions
   * through Tailwind's defaults, and `--d-base` for the one primitive that travels slower (the
   * list row's collapse), named there by its class. The `reduce` block beneath the gate is the
   * backstop that collapses every duration it let through.
   */
  it('declares every duration inside the gate the OS opens, and none outside it', () => {
    const allowedMotion = motionSection('no-preference');
    expect(allowedMotion).toContain('--default-transition-duration: var(--d-fast)');
    expect(allowedMotion).toContain('--default-transition-timing-function: var(--ease)');
    expect(allowedMotion).toMatch(/\.ui-list-item\s*\{\s*transition-duration: var\(--d-base\)/);
    expect(componentSources()).not.toMatch(/duration-\[/);
  });

  it('puts every transition utility behind the motion-safe variant, so the gate covers it', () => {
    expect(componentSources()).not.toMatch(/(?<!motion-safe:)\btransition-/);
  });

  it('collapses every duration when the OS asks for less', () => {
    const reducedMotion = motionSection('reduce');
    expect(reducedMotion).toContain('transition-duration: 0.001ms !important');
    expect(reducedMotion).toContain('animation-duration: 0.001ms !important');
    expect(reducedMotion).toContain('animation-iteration-count: 1 !important');
  });

  it('has no looping animation for the cap to truncate', () => {
    expect(BASE_CSS).not.toContain('infinite');
  });
});

describe('the app appearance script', () => {
  it('reads the one storage key the toggle writes, so a stored choice reaches first paint', () => {
    expect(APP_LAYOUT).toContain("localStorage.getItem('calm-theme')");
  });

  it('scopes every accent the area layouts declare, and declares exactly the scopes tokens.css names', () => {
    expect(accentScopesIn(AREA_LAYOUTS)).toEqual(accentScopesIn(TOKENS_CSS));
  });
});

/** Every custom property a source text reads through `var()`, deduplicated. */
function referencedValues(source: string): string[] {
  return [...new Set([...source.matchAll(/var\((--[\w-]+)/g)].map(([, name]) => name))];
}

/** The `data-app` scopes a stylesheet names, or the `app` each area layout renders it with. */
function accentScopesIn(source: string): string[] {
  const scopes = [...source.matchAll(/\[data-app='([\w-]+)'\]/g)].map(([, app]) => app);
  const declaredInLayout = [...source.matchAll(/<RouteLayout app="([\w-]+)"/g)].map(([, app]) => app);
  return [...new Set([...scopes, ...declaredInLayout])].sort();
}

function componentSources(): string {
  return readdirSync(COMPONENTS_DIRECTORY)
    .map((file) => readFileSync(join(COMPONENTS_DIRECTORY, file), 'utf8'))
    .join('\n');
}

/** WCAG relative luminance, so "lighter" is a measurement rather than an opinion. */
function relativeLuminance(colour: string): number {
  const channels = colour.replace('#', '').match(/../g) ?? [];
  if (channels.length !== 3) throw new Error(`${colour} is not a six-digit hex colour`);
  const [red, green, blue] = channels.map((channel) => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function bridgedRole(bridge: string): string {
  const matched = bridge.match(/^var\((--[\w-]+)\)$/);
  if (matched === null) throw new Error(`theme.css bridges onto ${bridge}, which is not a bare var()`);
  return matched[1];
}

function motionSection(preference: 'no-preference' | 'reduce'): string {
  const query = `@media (prefers-reduced-motion: ${preference})`;
  const queryStart = BASE_CSS.indexOf(query);
  if (queryStart === -1) throw new Error(`base.css does not declare ${query}`);
  return bracedBlockAt(BASE_CSS, BASE_CSS.indexOf('{', queryStart));
}

function expectedTailwindRoles(): Declarations {
  const roles = [...Object.keys(LIGHT_SCHEME), ...ACCENT_ROLES];
  return Object.fromEntries(roles.map((role) => [`--color-${role.slice('--'.length)}`, `var(${role})`]));
}

function tailwindColourRoles(): Declarations {
  return Object.fromEntries(
    Object.entries(declarationsOf(THEME_CSS, '@theme')).filter(([name]) => name.startsWith('--color-')),
  );
}

function tailwindColourRole(role: string): string {
  const mapped = tailwindColourRoles()[`--color-${role.slice('--'.length)}`];
  if (mapped === undefined) throw new Error(`theme.css does not map ${role}`);
  return mapped;
}

/** The dark set carried by the OS path, spliced out of its media block for the text parser. */
function systemScheme(): Declarations {
  return declarationsOf(systemStylesheet(), SYSTEM_ROOT_SELECTOR);
}

function systemStylesheet(): string {
  return bracedBlockAt(TOKENS_CSS, TOKENS_CSS.indexOf('{', TOKENS_CSS.indexOf(DARK_SCHEME_MEDIA)));
}

function declarationsOf(stylesheet: string, selector: string): Declarations {
  return customPropertiesIn(ruleBody(stylesheet, selector));
}

function ruleBody(stylesheet: string, selector: string): string {
  const selectorStart = stylesheet.indexOf(`${selector} {`);
  if (selectorStart === -1) throw new Error(`Stylesheet does not declare ${selector}`);
  return bracedBlockAt(stylesheet, stylesheet.indexOf('{', selectorStart));
}

function bracedBlockAt(stylesheet: string, openBrace: number): string {
  let depth = 0;
  for (let position = openBrace; position < stylesheet.length; position += 1) {
    if (stylesheet[position] === '{') depth += 1;
    if (stylesheet[position] === '}') depth -= 1;
    if (depth === 0) return stylesheet.slice(openBrace + 1, position);
  }
  throw new Error(`Unbalanced braces at offset ${openBrace}`);
}

function customPropertiesIn(block: string): Declarations {
  const declarations: Declarations = {};
  for (const [, name, value] of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    declarations[name] = value.trim();
  }
  return declarations;
}
