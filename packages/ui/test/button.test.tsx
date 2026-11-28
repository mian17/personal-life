import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Button, type ButtonSize, type ButtonVariant } from '../src/components/button';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('Button', () => {
  it('renders a <button> and defaults to primary/default', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button');
    expect(button.tagName).toBe('BUTTON');
    expect(button.textContent).toBe('Save');
    expect(button.classList.contains('ui-btn')).toBe(true);
    expect(button.classList.contains('ui-btn--default')).toBe(true);
    expect(button.classList.contains('ui-btn--primary')).toBe(true);
  });

  it.each<ButtonVariant>(['primary', 'ghost', 'filled', 'danger', 'quiet'])(
    'maps variant="%s" to its modifier class',
    (variant) => {
      render(<Button variant={variant}>x</Button>);
      expect(screen.getByRole('button').classList.contains(`ui-btn--${variant}`)).toBe(true);
    },
  );

  it('maps size="bare" to the size modifier class', () => {
    render(
      <Button size="bare" variant="primary">
        x
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button.classList.contains('ui-btn--bare')).toBe(true);
    expect(button.classList.contains('ui-btn--default')).toBe(false);
  });

  /**
   * Regression (visual defect M3): `bare` used to carry `min-h-0`, which dropped the tap floor
   * and rendered section-header actions 34–36px tall. The quiet look is the paint; the box is
   * still the touch minimum, so `--tap` (48px) is the floor and no negative min-height joins it.
   */
  it('keeps the tap floor on size="bare" instead of dropping it', () => {
    render(<Button size="bare">x</Button>);
    const classes = classesOf(screen.getByRole('button'));
    expect(classes).toContain('min-h-[var(--tap)]');
    expect(classes).not.toContain('min-h-0');
    // The design's one button inset: a content-sized action is inset like every other button.
    expect(classes).toContain('px-[var(--s6)]');
    expect(classes).not.toContain('px-[var(--s3)]');
  });

  it.each<ButtonSize>(['default', 'bare', 'icon'])(
    'maps size="%s" to its modifier class',
    (size) => {
      render(
        <Button size={size} variant="danger">
          x
        </Button>,
      );
      const button = screen.getByRole('button');
      expect(button.classList.contains(`ui-btn--${size}`)).toBe(true);
      const others: ButtonSize[] = (['default', 'bare', 'icon'] as ButtonSize[]).filter(
        (s) => s !== size,
      );
      for (const other of others) {
        expect(button.classList.contains(`ui-btn--${other}`)).toBe(false);
      }
    },
  );

  it('gives danger + icon no surface of its own, while the glyph stays danger', () => {
    render(
      <Button variant="danger" size="icon">
        x
      </Button>,
    );
    const classes = classesOf(screen.getByRole('button'));
    // Borderless: the panel behind the button is the surface.
    expect(classes).not.toContain('border');
    expect(classes).not.toContain('border-line-strong');
    expect(classes).not.toContain('bg-surface');
    expect(classes).toContain('size-[var(--tap)]');
    expect(classes).toContain('text-danger');
  });

  it('fills the primary variant with the scoped accent and draws the word on it', () => {
    render(<Button>Save</Button>);
    const classes = classesOf(screen.getByRole('button'));
    expect(classes).toContain('bg-max');
    expect(classes).toContain('text-on-max');
    expect(classes).toContain('border-max');
    expect(classes).toContain('active:bg-max-press');
    // The retired vocabulary: a fill that resolves against a root alias instead of the app scope.
    expect(classes).not.toContain('bg-accent');
    expect(classes).not.toContain('text-on-accent');
  });

  it('carries the disabled treatment on the rendered element', () => {
    render(<Button disabled>x</Button>);
    const button = screen.getByRole('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.classList.contains('disabled:opacity-50')).toBe(true);
    expect(button.classList.contains('disabled:cursor-not-allowed')).toBe(true);
  });

  it('merges className instead of replacing it', () => {
    render(<Button className="legacy-hook">x</Button>);
    const classes = classesOf(screen.getByRole('button'));
    expect(classes).toContain('ui-btn');
    expect(classes).toContain('ui-btn--primary');
    expect(classes).toContain('legacy-hook');
  });

  it('defaults type to "button" and forwards an explicit type', () => {
    const { rerender } = render(<Button>x</Button>);
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');

    rerender(<Button type="submit">x</Button>);
    expect(screen.getByRole('button').getAttribute('type')).toBe('submit');
  });

  it('forwards onClick', () => {
    const onClick = jest.fn();
    render(<Button onClick={onClick}>x</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('forwards arbitrary button attributes', () => {
    render(
      <Button
        aria-label="Delete thing"
        title="Delete"
        name="action"
        value="delete"
        formAction="/run"
        disabled
      >
        x
      </Button>,
    );
    const button = screen.getByRole('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Delete thing');
    expect(button.getAttribute('title')).toBe('Delete');
    expect(button.getAttribute('name')).toBe('action');
    expect(button.getAttribute('value')).toBe('delete');
    expect(button.getAttribute('formAction')).toBe('/run');
    expect(button.disabled).toBe(true);
  });

  it('forwards a ref to the rendered element', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>x</Button>);
    expect(ref.current).toBe(screen.getByRole('button'));
  });

  /**
   * Regression: Tailwind v4's `outline-none` zeroes `--tw-outline-style`, so
   * `focus-visible:outline-2` alone computes `outline-style: none` and the ring never draws.
   * `focus-visible:outline-solid` must be present to re-arm it.
   */
  it('re-arms the outline style the reset zeroes, so the focused ring draws', () => {
    render(<Button>x</Button>);
    const button = screen.getByRole('button');
    expect(button.classList.contains('focus-visible:outline-solid')).toBe(true);
    expect(button.classList.contains('focus-visible:outline-[length:var(--focus-ring)]')).toBe(
      true,
    );
  });
});

describe('Button — shape, the text face and the hero size', () => {
  it('keeps the library --r-md corner by default', () => {
    render(<Button>Start</Button>);
    const classes = classesOf(screen.getByRole('button'));
    expect(classes).toContain('rounded-[var(--r-md)]');
    expect(classes).not.toContain('rounded-[var(--r-pill)]');
  });

  it('selects the pill corner instead of stacking a second radius', () => {
    render(<Button shape="pill">Start</Button>);
    const classes = classesOf(screen.getByRole('button'));
    expect(classes).toContain('rounded-[var(--r-pill)]');
    expect(classes).not.toContain('rounded-[var(--r-md)]');
  });

  it('adds variant="text" as a union member, leaving every shipped face alone', () => {
    render(
      <Button variant="text" size="bare">
        Cancel
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button.classList.contains('ui-btn--text')).toBe(true);
    expect(button.classList.contains('ui-btn--primary')).toBe(false);
    const classes = classesOf(button);
    expect(classes).toContain('text-ink-2');
    expect(classes).toContain('active:bg-press');
    expect(classes).not.toContain('bg-max');
    expect(classes).not.toContain('text-on-max');
  });

  /**
   * The word button owns its box: `--r-sm` and an `--s3` inset are the design's numbers, and the
   * `!` is what makes them win over the size and shape it was not asked for — `cx` joins and never
   * merges, so a later declaration has to be beaten rather than assumed to be last.
   */
  it('gives the text face its own corner and inset', () => {
    render(<Button variant="text">Cancel</Button>);
    const classes = classesOf(screen.getByRole('button'));
    expect(classes).toContain('rounded-[var(--r-sm)]!');
    expect(classes).toContain('px-[var(--s3)]!');
  });

  /**
   * The word button is the design's `.text-button`, which states no weight at all: it reads at the
   * body's 400, not at the semibold face the shared button paints.
   */
  it('drops the text face to the body weight, beating the shared semibold', () => {
    render(<Button variant="text">Cancel</Button>);
    const classes = classesOf(screen.getByRole('button'));
    expect(classes).toContain('[font-weight:var(--fw-body)]!');
    expect(classes).toContain('font-semibold');
  });

  it('adds variant="filled" as the surface face on a hairline, leaving every other face alone', () => {
    render(<Button variant="filled">Keep going</Button>);
    const button = screen.getByRole('button');
    expect(button.classList.contains('ui-btn--filled')).toBe(true);
    const classes = classesOf(button);
    expect(classes).toContain('bg-surface');
    expect(classes).toContain('text-ink');
    expect(classes).toContain('border-line');
    expect(classes).toContain('active:bg-press');
    expect(classes).not.toContain('bg-max');
    expect(classes).not.toContain('text-on-max');
    expect(classes).not.toContain('border-line-strong');
  });

  it('adds size="hero" as a union member on the fab floor, with no margin of its own', () => {
    render(<Button size="hero">Start</Button>);
    const button = screen.getByRole('button');
    expect(button.classList.contains('ui-btn--hero')).toBe(true);
    const classes = classesOf(button);
    expect(classes).toContain('min-h-[var(--fab-size)]');
    expect(classes).toContain('w-full');
    expect(classes).not.toContain('min-h-[var(--tap)]');
    // A size is a metric, not a layout: the step above Start belongs to the call site.
    expect(classes.some((utility) => utility.startsWith('mt-'))).toBe(false);
  });
});
