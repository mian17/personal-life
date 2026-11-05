import { fireEvent, render, screen } from '@testing-library/react';
import { IconButton } from '../src/components/icon-button';

describe('IconButton', () => {
  it('renders a type="button" <button> with the label as its aria-label', () => {
    render(<IconButton label="Back">{<span data-testid="icon" />}</IconButton>);
    const button = screen.getByRole('button', { name: 'Back' });
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-label')).toBe('Back');
  });

  it('renders its children (the icon) inside the button', () => {
    render(<IconButton label="Back">{<span data-testid="icon" />}</IconButton>);
    const button = screen.getByRole('button', { name: 'Back' });
    expect(button.contains(screen.getByTestId('icon'))).toBe(true);
  });

  it('carries the base hook and no modifier for the default variant', () => {
    render(<IconButton label="Back">{<span />}</IconButton>);
    const button = screen.getByRole('button');
    expect(button.classList.contains('ui-icon-btn')).toBe(true);
    expect(button.classList.contains('ui-icon-btn--ghost')).toBe(false);
  });

  it('adds the variant modifier for non-default variants', () => {
    render(
      <IconButton label="Back" variant="ghost">
        {<span />}
      </IconButton>,
    );
    const button = screen.getByRole('button');
    expect(button.classList.contains('ui-icon-btn')).toBe(true);
    expect(button.classList.contains('ui-icon-btn--ghost')).toBe(true);
  });

  it('dresses the framed variant in the IconLink framed face over the shared base', () => {
    render(
      <IconButton label="Back" variant="framed">
        {<span />}
      </IconButton>,
    );
    const button = screen.getByRole('button');
    const classes = button.classList;
    expect(classes.contains('ui-icon-btn')).toBe(true);
    expect(classes.contains('ui-icon-btn--framed')).toBe(true);
    expect(classes.contains('border-line')).toBe(true);
    expect(classes.contains('bg-surface')).toBe(true);
    expect(classes.contains('text-ink')).toBe(true);
    expect(classes.contains('size-[var(--tap)]')).toBe(true);
    expect(classes.contains('rounded-[var(--r-md)]')).toBe(true);
    // The borderless face's declaration must not ride along, or the two contest one property.
    expect(classes.contains('border-0')).toBe(false);
    expect(classes.contains('bg-transparent')).toBe(false);
    expect(classes.contains('text-ink-2')).toBe(false);
  });

  it('stays a transparent square carrying the second ink tier and no border', () => {
    render(<IconButton label="Back">{<span />}</IconButton>);
    const classes = screen.getByRole('button').classList;
    expect(classes.contains('bg-transparent')).toBe(true);
    expect(classes.contains('text-ink-2')).toBe(true);
    expect(classes.contains('border-0')).toBe(true);
    expect(classes.contains('size-[var(--tap)]')).toBe(true);
    expect(classes.contains('rounded-[var(--r-md)]')).toBe(true);
  });

  it('merges className instead of replacing it', () => {
    render(
      <IconButton label="Save" className="legacy-hook">
        {<span />}
      </IconButton>,
    );
    const classes = screen.getByRole('button').classList;
    expect(classes.contains('ui-icon-btn')).toBe(true);
    expect(classes.contains('legacy-hook')).toBe(true);
  });

  it('forwards disabled and carries its treatment on the rendered element', () => {
    render(
      <IconButton label="Save" disabled>
        {<span />}
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.classList.contains('disabled:opacity-50')).toBe(true);
    expect(button.classList.contains('disabled:cursor-not-allowed')).toBe(true);
  });

  it('forwards onClick and arbitrary attributes', () => {
    const onClick = jest.fn();
    render(
      <IconButton label="Save" onClick={onClick} data-extra="1">
        {<span />}
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('data-extra')).toBe('1');
  });

  /**
   * Regression: Tailwind v4's `outline-none` zeroes `--tw-outline-style`, so
   * `focus-visible:outline-2` alone computes `outline-style: none` and the ring never draws.
   * `focus-visible:outline-solid` must be present to re-arm it.
   */
  it('re-arms the outline style the reset zeroes, so the focused ring draws', () => {
    render(<IconButton label="Back">{<span />}</IconButton>);
    const button = screen.getByRole('button');
    expect(button.classList.contains('focus-visible:outline-solid')).toBe(true);
    expect(button.classList.contains('focus-visible:outline-[length:var(--focus-ring)]')).toBe(true);
  });
});
