import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/react';
import { SettingsRow } from '../src/components/settings-row';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

function cssBlock(selector: string): string {
  const css = readFileSync(join(__dirname, '..', 'src', 'styles', 'blocks.css'), 'utf8');
  return (
    (css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)) ??
      [])[1] ?? ''
  );
}

describe('SettingsRow', () => {
  it('renders the label in the left column', () => {
    render(<SettingsRow label="Theme" control={<span />} />);
    const row = document.querySelector('.ui-settings-row')!;
    const text = row.querySelector('.ui-settings-row__text')!;
    const label = text.querySelector('.ui-settings-row__label')!;
    expect(label.textContent).toBe('Theme');
    expect(row.firstElementChild).toBe(text);
  });

  it('renders the control verbatim in the right column', () => {
    render(
      <SettingsRow label="Theme" control={<button type="button">Toggle</button>} />,
    );
    const control = document.querySelector('.ui-settings-row__control')!;
    expect(control.querySelector('button')!.textContent).toBe('Toggle');
    expect(document.querySelector('.ui-settings-row')!.lastElementChild).toBe(control);
  });

  it('renders a muted description under the label', () => {
    render(
      <SettingsRow label="Theme" description="System, light, or dark." control={<span />} />,
    );
    const desc = document.querySelector('.ui-settings-row__desc')!;
    expect(desc.textContent).toBe('System, light, or dark.');
    expect(cssBlock('.ui-settings-row__desc')).toMatch(/color:\s*var\(--muted\)/);
  });

  it('omits the description when undefined', () => {
    render(<SettingsRow label="Theme" control={<span />} />);
    expect(document.querySelector('.ui-settings-row__desc')).toBeNull();
  });

  it('merges className instead of replacing the base class', () => {
    render(<SettingsRow label="Theme" control={<span />} className="legacy-hook" />);
    expect(classesOf(document.querySelector('.ui-settings-row')!)).toEqual([
      'legacy-hook',
      'ui-settings-row',
    ]);
  });

  // The narrow-screen rule lives in a `@media` block — jsdom never applies
  // media queries, so the emitted rule text is the assertion surface (lesson
  // 0025): the CSS is what a narrow device renders.
  describe('responsive stacking', () => {
    const css = readFileSync(join(__dirname, '..', 'src', 'styles', 'blocks.css'), 'utf8');

    it('emits the two-column default and the sm stacking override', () => {
      // Default (>= sm): label left, control right, row stays a row.
      const base = cssBlock('.ui-settings-row');
      expect(base).toMatch(/display:\s*flex/);
      expect(base).not.toMatch(/flex-direction:\s*column/);

      // Below sm (640px): the row stacks — label above a full-width control.
      const media = css.match(/@media\s*\(max-width:\s*640px\)\s*\{([\s\S]*?)\n\}/)!;
      expect(media).not.toBeNull();
      const stacked = media[1];
      expect(stacked).toMatch(/\.ui-settings-row\s*\{/);
      expect(stacked).toMatch(/flex-direction:\s*column/);
      expect(stacked).toMatch(/align-items:\s*stretch/);
      // The breakpoint is the documented sm value, named in the CSS.
      expect(css).toMatch(/sm — 640px/);
    });
  });
});
