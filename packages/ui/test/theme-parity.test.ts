/**
 * Proves the colour parity the migration rests on: the utility class a rendered primitive
 * carries walks its `var(--…)` chain through `theme.css` and `tokens.css` to the frozen
 * literal, in both themes. jsdom does not resolve `var()`, so the chain is walked through
 * the injected sheets' CSSOM instead of `getComputedStyle`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { Button } from '../src/components/button';
import { IconButton } from '../src/components/icon-button';

const STYLES_DIRECTORY = join(__dirname, '../src/styles');

const THEMES = ['light', 'dark'] as const;

type Theme = (typeof THEMES)[number];

/** The 11 frozen colours — the same values `tokens.test.ts` pins, read here as parity proof. */
const FROZEN_COLOURS: Record<Theme, Record<string, string>> = {
  light: {
    '--bg': '#f4f5f7',
    '--panel': '#ffffff',
    '--text': '#1a1d24',
    '--muted': '#5c6577',
    '--accent': '#2f6bff',
    '--danger': '#d64545',
    '--danger-soft': '#d97070',
    '--amber': '#b45309',
    '--green': '#15803d',
    '--border': '#dfe3ea',
    '--on-accent': 'white',
  },
  dark: {
    '--bg': '#0f1115',
    '--panel': '#181b22',
    '--text': '#e8eaf0',
    '--muted': '#8b93a7',
    '--accent': '#5b8cff',
    '--danger': '#ff6b6b',
    '--danger-soft': '#ff9e9e',
    '--amber': '#f2b64c',
    '--green': '#4cc38a',
    '--border': '#2a2f3a',
    '--on-accent': 'white',
  },
};

injectStylesheets();

describe.each(THEMES)('the %s theme', (theme) => {
  beforeEach(() => {
    document.documentElement.dataset.theme = theme;
  });

  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });

  it('holds all eleven frozen colours', () => {
    expect(Object.keys(FROZEN_COLOURS[theme])).toHaveLength(11);
  });

  it('resolves every frozen colour on a rendered element to its frozen literal', () => {
    for (const token of Object.keys(FROZEN_COLOURS[theme])) {
      const probe = renderColourProbe(token);
      expectFrozenColour(probe, `bg-${token.slice('--'.length)}`);
    }
  });

  it('paints the converted primary Button in the frozen accent and on-accent', () => {
    render(createElement(Button, null, 'Save'));

    const button = screen.getByRole('button', { name: 'Save' });
    expectFrozenColour(button, 'bg-accent');
    expectFrozenColour(button, 'text-on-accent');
  });

  it('paints the converted default IconButton in the frozen panel, text and border', () => {
    render(createElement(IconButton, { label: 'Delete' }, '×'));

    const iconButton = screen.getByRole('button', { name: 'Delete' });
    expectFrozenColour(iconButton, 'bg-panel');
    expectFrozenColour(iconButton, 'text-text');
    expectFrozenColour(iconButton, 'border-border');
  });

  it('fails rather than defaults when theme.css does not map a token', () => {
    expect(() => resolveColourToken('--unmapped')).toThrow(/theme.css does not map --unmapped/);
  });
});

function renderColourProbe(token: string): HTMLElement {
  const colourName = token.slice('--'.length);
  render(createElement('span', { 'data-testid': `probe-${colourName}`, className: `bg-${colourName}` }));
  return screen.getByTestId(`probe-${colourName}`);
}

function expectFrozenColour(element: Element, utilityClass: string): void {
  const token = `--${utilityClass.slice(utilityClass.indexOf('-') + 1)}`;
  expect(element.classList.contains(utilityClass)).toBe(true);
  expect(resolveColourToken(token)).toBe(FROZEN_COLOURS[appliedTheme()][token]);
}

function injectStylesheets(): void {
  appendStylesheet('tokens.css');
  appendStylesheet('theme.css');
}

function appendStylesheet(file: string): void {
  const style = document.createElement('style');
  style.textContent = readFileSync(join(STYLES_DIRECTORY, file), 'utf8');
  document.head.append(style);
}

function appliedTheme(): Theme {
  const theme = document.documentElement.dataset.theme;
  if (theme !== 'light' && theme !== 'dark') throw new Error(`No theme applied: ${theme}`);
  return theme;
}

function palette(): Record<string, string> {
  return {
    ...declarationsIn(':root'),
    ...declarationsIn(`:root[data-theme='${appliedTheme()}']`),
  };
}

function resolveColourToken(token: string): string {
  const mapping = declarationsIn('@theme')[`--color-${token.slice('--'.length)}`];
  if (mapping === undefined) throw new Error(`theme.css does not map ${token}`);
  return resolveVariableChain(mapping);
}

function resolveVariableChain(value: string): string {
  const declarations = palette();
  let literal = value;
  while (literal.startsWith('var(')) {
    const referenced = literal.slice('var('.length, -1).trim();
    const declared = declarations[referenced];
    if (declared === undefined) throw new Error(`tokens.css does not declare ${referenced}`);
    literal = declared;
  }
  return literal;
}

function declarationsIn(selector: string): Record<string, string> {
  return customPropertiesOf(findStyleRule(selector).style);
}

function findStyleRule(selector: string): CSSStyleRule {
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      if (styleRuleSelector(rule) === selector) return rule as CSSStyleRule;
    }
  }
  throw new Error(`Stylesheet rule not found: ${selector}`);
}

function styleRuleSelector(rule: CSSRule): string | undefined {
  const { selectorText } = rule as CSSStyleRule;
  return typeof selectorText === 'string' ? selectorText : undefined;
}

function customPropertiesOf(style: CSSStyleDeclaration): Record<string, string> {
  const properties: Record<string, string> = {};
  for (const name of Array.from(style)) {
    if (name.startsWith('--')) properties[name] = style.getPropertyValue(name).trim();
  }
  return properties;
}
