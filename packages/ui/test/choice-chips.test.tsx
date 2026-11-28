import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChoiceChips, type ChoiceChipOption } from '../src/components/choice-chips';

const REPEATS: ChoiceChipOption[] = [
  { value: '', label: '∞', ariaLabel: 'Repeat: unlimited' },
  { value: '1', label: '1', ariaLabel: 'Repeat: 1×' },
  { value: '2', label: '2', ariaLabel: 'Repeat: 2×' },
  { value: '3', label: '3', ariaLabel: 'Repeat: 3×' },
  { value: '4', label: '4', ariaLabel: 'Repeat: 4×' },
  { value: '5', label: '5', ariaLabel: 'Repeat: 5×' },
  { value: '6', label: '6', ariaLabel: 'Repeat: 6×' },
];

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean);
}

const pressedOf = (name: string) =>
  screen.getByRole('button', { name }).getAttribute('aria-pressed');

/** A controlled run, so a press is observable as the state it produced. */
function Harness({ disabled = false }: Readonly<{ disabled?: boolean }>) {
  const [value, setValue] = useState('');
  return (
    <ChoiceChips
      label="Repeat"
      options={REPEATS}
      value={value}
      onChange={setValue}
      disabled={disabled}
    />
  );
}

describe('ChoiceChips', () => {
  it('names the run once, as a group, instead of naming it visually only', () => {
    render(<ChoiceChips label="Repeat" options={REPEATS} value="" onChange={() => {}} />);

    const group = screen.getByRole('group', { name: 'Repeat' });
    expect(group.tagName).toBe('FIELDSET');
    expect(group.hasAttribute('role')).toBe(false);
    expect(group.querySelectorAll('button')).toHaveLength(REPEATS.length);
  });

  it('exposes the pressed state on the button, and never a second source', () => {
    render(<ChoiceChips label="Repeat" options={REPEATS} value="3" onChange={() => {}} />);

    expect(pressedOf('Repeat: 3×')).toBe('true');
    expect(pressedOf('Repeat: 1×')).toBe('false');
    expect(screen.getByRole('button', { name: 'Repeat: 3×' }).hasAttribute('data-state')).toBe(
      false,
    );
  });

  it('keeps the word "unlimited" in the endless chip name behind the ∞ mark', () => {
    render(<ChoiceChips label="Repeat" options={REPEATS} value="" onChange={() => {}} />);

    const endless = screen.getByRole('button', { name: 'Repeat: unlimited' });
    expect(endless.textContent).toBe('∞');
  });

  it('reports the pressed option as the single select, then flips it', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Repeat: 3×' }));

    expect(pressedOf('Repeat: 3×')).toBe('true');
    expect(pressedOf('Repeat: unlimited')).toBe('false');
    expect(
      [...screen.getAllByRole('button')].filter(
        (chip) => chip.getAttribute('aria-pressed') === 'true',
      ),
    ).toHaveLength(1);
  });

  it('leaves the run unpressed rather than inventing a choice', () => {
    render(<ChoiceChips label="Repeat" options={REPEATS} value="42" onChange={() => {}} />);

    expect(
      [...screen.getAllByRole('button')].filter(
        (chip) => chip.getAttribute('aria-pressed') === 'true',
      ),
    ).toHaveLength(0);
  });

  it('selects the accent face as a group, never the sunken fill beside it', () => {
    render(<ChoiceChips label="Repeat" options={REPEATS} value="2" onChange={() => {}} />);

    const pressed = classesOf(screen.getByRole('button', { name: 'Repeat: 2×' }));
    expect(pressed).toContain('bg-max');
    expect(pressed).toContain('border-max');
    expect(pressed).toContain('text-on-max');
    expect(pressed).not.toContain('bg-surface-sunken');
    expect(pressed).not.toContain('text-ink-2');

    const unpressed = classesOf(screen.getByRole('button', { name: 'Repeat: 4×' }));
    expect(unpressed).toContain('bg-surface-sunken');
    expect(unpressed).toContain('border-line');
    expect(unpressed).not.toContain('bg-max');
  });

  it('keeps the tap floor and the focus ring on every chip', () => {
    render(<ChoiceChips label="Repeat" options={REPEATS} value="" onChange={() => {}} />);

    const classes = classesOf(screen.getByRole('button', { name: 'Repeat: 1×' }));
    expect(classes).toContain('min-w-[var(--tap)]');
    expect(classes).toContain('min-h-[var(--tap)]');
    expect(classes).toContain('rounded-[var(--r-pill)]');
    expect(classes).toContain('focus-visible:outline-[length:var(--focus-ring)]');
  });

  it('disables every chip in the run, so a refused group is refused whole', () => {
    render(<Harness disabled />);

    for (const chip of screen.getAllByRole('button')) {
      expect((chip as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
