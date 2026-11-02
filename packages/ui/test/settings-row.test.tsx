import { render } from '@testing-library/react';
import { SettingsRow } from '../src/components/settings-row';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
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
    expect(desc.classList.contains('text-ink-2')).toBe(true);
  });

  it('omits the description when undefined', () => {
    render(<SettingsRow label="Theme" control={<span />} />);
    expect(document.querySelector('.ui-settings-row__desc')).toBeNull();
  });

  it('merges className instead of replacing the base class', () => {
    render(<SettingsRow label="Theme" control={<span />} className="legacy-hook" />);
    expect(classesOf(document.querySelector('.ui-settings-row')!)).toEqual(
      expect.arrayContaining(['legacy-hook', 'ui-settings-row']),
    );
  });

  // jsdom never applies media queries, so the narrow-screen behaviour is read
  // off the classes the row carries: `max-sm` is what a narrow device renders.
  describe('responsive stacking', () => {
    it('keeps the two-column default and stacks below sm', () => {
      render(<SettingsRow label="Theme" control={<span />} />);
      const row = document.querySelector('.ui-settings-row')!;

      // Default (>= sm): label left, control right, row stays a row.
      expect(row.classList.contains('flex')).toBe(true);
      expect(row.classList.contains('flex-col')).toBe(false);

      // Below sm: the row stacks — label above a full-width control.
      expect(row.classList.contains('max-sm:flex-col')).toBe(true);
      expect(row.classList.contains('max-sm:items-stretch')).toBe(true);
    });
  });
});
