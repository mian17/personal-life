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
});
