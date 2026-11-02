import { render, screen } from '@testing-library/react';
import { AlertBanner } from '../src/components/alert-banner';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('AlertBanner', () => {
  it('renders the registry alert slot carrying the ui-alert-banner hook', () => {
    render(<AlertBanner>Changed on another device.</AlertBanner>);
    const banner = document.querySelector('.ui-alert-banner')!;
    expect(banner.tagName).toBe('DIV');
    // The e2e locator (`meals.spec.ts`) finds `.ui-alert-banner`; the registry
    // markup hook has to ride the same element, or there is no banner to find.
    expect(banner.getAttribute('data-slot')).toBe('alert');
    expect(banner.classList.contains('ui-alert-banner--warning')).toBe(true);
  });

  it('paints the warning tone from token utilities', () => {
    render(<AlertBanner>Changed.</AlertBanner>);
    const banner = document.querySelector('.ui-alert-banner')!;
    expect(banner.classList.contains('border-warn')).toBe(true);
    expect(banner.classList.contains('bg-warn-soft')).toBe(true);
    expect(banner.classList.contains('rounded-[var(--r-lg)]')).toBe(true);
  });

  it('forwards role="alert" verbatim (the editor conflict banner contract)', () => {
    render(<AlertBanner role="alert">Changed on another device.</AlertBanner>);
    const banner = screen.getByRole('alert');
    expect(banner.classList.contains('ui-alert-banner')).toBe(true);
    expect(banner.getAttribute('role')).toBe('alert');
  });

  it('renders children inside the ui-alert-banner__text paragraph', () => {
    render(<AlertBanner role="alert">Changed on another device.</AlertBanner>);
    const text = document.querySelector('.ui-alert-banner__text')!;
    expect(text.tagName).toBe('P');
    expect(text.textContent).toBe('Changed on another device.');
    expect(screen.getByRole('alert').contains(text)).toBe(true);
  });

  it('renders the actions slot inside ui-alert-banner__actions', () => {
    render(
      <AlertBanner
        role="alert"
        actions={
          <>
            <button type="button">Load latest</button>
            <button type="button">Keep mine (overwrite)</button>
          </>
        }
      >
        Changed on another device.
      </AlertBanner>,
    );
    const actions = document.querySelector('.ui-alert-banner__actions')!;
    expect(actions.children).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Load latest' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep mine (overwrite)' })).toBeTruthy();
    expect(screen.getByRole('alert').contains(actions)).toBe(true);
  });

  it('omits the actions container when no actions are provided', () => {
    render(<AlertBanner role="alert">Changed.</AlertBanner>);
    expect(document.querySelector('.ui-alert-banner__actions')).toBeNull();
  });

  it('merges className instead of replacing it', () => {
    render(
      <AlertBanner className="legacy-hook" role="alert">
        Changed.
      </AlertBanner>,
    );
    expect(classesOf(screen.getByRole('alert'))).toEqual(
      expect.arrayContaining(['legacy-hook', 'ui-alert-banner', 'ui-alert-banner--warning']),
    );
  });
});
