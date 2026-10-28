import { fireEvent, render, screen } from '@testing-library/react';
import { Switch } from '../src/components/switch';

describe('Switch', () => {
  it('renders a <button type="button" role="switch"> with aria-checked and aria-label', () => {
    render(<Switch checked label="Eisenhower matrix" />);
    const sw = screen.getByRole('switch');
    expect(sw.tagName).toBe('BUTTON');
    expect(sw.getAttribute('type')).toBe('button');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.getAttribute('aria-label')).toBe('Eisenhower matrix');
    expect(sw.classList.contains('ui-switch--on')).toBe(true);
  });

  it('reflects checked=false with aria-checked="false"', () => {
    render(<Switch checked={false} label="Eisenhower matrix" />);
    const sw = screen.getByRole('switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.classList.contains('ui-switch--on')).toBe(false);
  });

  it('fires onCheckedChange with the negated value', () => {
    const onCheckedChange = jest.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} label="Eisenhower matrix" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('stays controlled: a re-render reflects the prop, never internal state', () => {
    const onCheckedChange = jest.fn();
    const { rerender } = render(
      <Switch checked={false} onCheckedChange={onCheckedChange} label="Eisenhower matrix" />,
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');

    rerender(<Switch checked onCheckedChange={onCheckedChange} label="Eisenhower matrix" />);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });

  it('blocks the callback when disabled', () => {
    const onCheckedChange = jest.fn();
    render(
      <Switch checked={false} onCheckedChange={onCheckedChange} label="Eisenhower matrix" disabled />,
    );
    const sw = screen.getByRole('switch');
    expect((sw as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(sw);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('merges className instead of replacing the base classes', () => {
    render(<Switch checked label="Eisenhower matrix" className="legacy-hook" />);
    const sw = screen.getByRole('switch');
    expect(sw.classList.contains('ui-switch')).toBe(true);
    expect(sw.classList.contains('legacy-hook')).toBe(true);
  });

  it('passes name through to the button', () => {
    render(<Switch checked label="Eisenhower matrix" name="matrixEnabled" />);
    expect(screen.getByRole('switch').getAttribute('name')).toBe('matrixEnabled');
  });
});

describe('Switch focus ring', () => {
  /**
   * Regression: Tailwind v4's `outline-none` and `outline-hidden` both zero the
   * `--tw-outline-style` variable that `outline-<width>` draws with, so a ring written as
   * `outline-none` + `focus-visible:outline-2` computes `outline-style: none` in Chromium and
   * is invisible. `outline-solid` must be present to re-arm it.
   */
  it('re-arms the outline style the reset zeroes, so the focused ring actually draws', () => {
    render(<Switch checked label="Eisenhower matrix" />);
    const track = screen.getByRole('switch');
    expect(track.classList.contains('focus-visible:outline-solid')).toBe(true);
    expect(track.classList.contains('focus-visible:outline-[length:var(--focus-ring)]')).toBe(true);
    expect(track.classList.contains('focus-visible:outline-accent')).toBe(true);
    // The reset itself must not zero anything the ring needs back.
    expect(track.classList.contains('outline-none')).toBe(false);
  });
});
