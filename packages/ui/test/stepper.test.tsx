import { fireEvent, render, screen } from '@testing-library/react';
import { Stepper } from '../src/components/stepper';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean);
}

const decrease = () => screen.getByRole('button', { name: 'Decrease duration' });
const increase = () => screen.getByRole('button', { name: 'Increase duration' });

function renderDuration(overrides: Partial<Parameters<typeof Stepper>[0]> = {}) {
  const onDecrease = jest.fn();
  const onIncrease = jest.fn();
  render(
    <Stepper
      tone="card"
      size="display"
      readout={{ kind: 'text', value: '10', unit: 'minutes' }}
      decreaseLabel="Decrease duration"
      increaseLabel="Increase duration"
      onDecrease={onDecrease}
      onIncrease={onIncrease}
      {...overrides}
    />,
  );
  return { onDecrease, onIncrease };
}

describe('Stepper', () => {
  it('names each button from the caller label, never from its glyph', () => {
    renderDuration();

    expect(decrease().getAttribute('aria-label')).toBe('Decrease duration');
    expect(increase().getAttribute('aria-label')).toBe('Increase duration');
    expect(decrease().getAttribute('type')).toBe('button');
  });

  it('hides both glyphs, because the labels already name the actions', () => {
    renderDuration();

    const glyphs = [...document.querySelectorAll('.ui-stepper__button > span')];
    expect(glyphs).toHaveLength(2);
    for (const glyph of glyphs) expect(glyph.getAttribute('aria-hidden')).toBe('true');
    expect(glyphs.map((glyph) => glyph.textContent)).toEqual(['−', '+']);
  });

  it('moves the value one press at a time', () => {
    const { onDecrease, onIncrease } = renderDuration();

    fireEvent.click(decrease());
    fireEvent.click(increase());

    expect(onDecrease).toHaveBeenCalledTimes(1);
    expect(onIncrease).toHaveBeenCalledTimes(1);
  });

  it('disables the button at the end of the range, so an inert key is also out of the tab order', () => {
    renderDuration({ decreaseDisabled: true });

    expect((decrease() as HTMLButtonElement).disabled).toBe(true);
    expect((increase() as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables only the end it was told about', () => {
    renderDuration({ increaseDisabled: true });

    expect((decrease() as HTMLButtonElement).disabled).toBe(false);
    expect((increase() as HTMLButtonElement).disabled).toBe(true);
  });

  it('announces a text read-out through <output>, the element for a calculated result', () => {
    renderDuration();

    const readout = document.querySelector('output')!;
    expect(readout).not.toBeNull();
    expect(readout.textContent).toBe('10minutes');
    expect(readout.querySelector('.ui-stepper__unit')!.textContent).toBe('minutes');
  });

  it('sets the figure tier on the value and the label tier on its unit', () => {
    renderDuration();

    const value = document.querySelector('.ui-stepper__value')!;
    const unit = document.querySelector('.ui-stepper__unit')!;
    expect(classesOf(value)).toContain('text-[length:var(--fs-timer)]');
    expect(classesOf(value)).toContain('tracking-[var(--tracking-timer)]');
    expect(classesOf(unit)).toContain('uppercase');
    expect(classesOf(unit)).toContain('text-ink-2');
  });

  it('falls back to the row tier, one line at the row-title size, with no unit treatment', () => {
    renderDuration({ size: 'row', readout: { kind: 'text', value: 'Every 10 min' } });

    const readout = document.querySelector('output')!;
    expect(classesOf(readout)).toContain('text-[length:var(--fs-row-title)]');
    expect(classesOf(readout)).not.toContain('text-[length:var(--fs-timer)]');
    expect(document.querySelector('.ui-stepper__unit')).toBeNull();
  });

  it('renders a control read-out as a direct child, so the row it shares is not eaten', () => {
    renderDuration({
      size: 'row',
      readout: { kind: 'control', children: <div data-testid="trio" /> },
    });

    const control = screen.getByTestId('trio');
    expect(control.parentElement).toBe(document.querySelector('.ui-stepper'));
    expect(document.querySelector('output')).toBeNull();
  });

  it.each([
    ['card', 'bg-surface'],
    ['row', 'bg-surface-sunken'],
    ['bare', null],
  ] as const)('selects one surface per tone (%s)', (tone, fill) => {
    render(
      <Stepper
        tone={tone}
        readout={{ kind: 'text', value: '10' }}
        decreaseLabel="Decrease duration"
        increaseLabel="Increase duration"
        onDecrease={() => {}}
        onIncrease={() => {}}
      />,
    );

    const container = document.querySelector('.ui-stepper')!;
    expect(container.classList.contains(`ui-stepper--${tone}`)).toBe(true);
    const otherFills = ['bg-surface', 'bg-surface-sunken'].filter(
      (candidate) => candidate !== fill,
    );
    for (const other of otherFills) expect(container.classList.contains(other)).toBe(false);
    if (fill != null) expect(container.classList.contains(fill)).toBe(true);
  });

  it('draws the ± disc on the tap floor with the library focus treatment', () => {
    renderDuration();

    const classes = classesOf(decrease());
    expect(classes).toContain('size-[var(--tap)]');
    expect(classes).toContain('rounded-[var(--r-pill)]');
    expect(classes).toContain('active:bg-press');
    expect(classes).toContain('focus-visible:outline-[length:var(--focus-ring)]');
    expect(classes).toContain('disabled:opacity-50');
  });
});
