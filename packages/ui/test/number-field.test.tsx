import { fireEvent, render, screen } from '@testing-library/react';
import { NumberField } from '../src/components/number-field';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean);
}

const field = (name: string) => screen.getByRole('spinbutton', { name }) as HTMLInputElement;

const hours = () => field('Start offset hours');

describe('NumberField', () => {
  it('names the control itself, so the visible unit is never read twice', () => {
    render(<NumberField label="Start offset hours" value={0} onChange={() => {}} unit="h" />);

    const input = hours();
    expect(input.tagName).toBe('INPUT');
    expect(input.getAttribute('type')).toBe('number');
    expect(input.getAttribute('inputmode')).toBe('numeric');

    const unit = document.querySelector('.ui-number-field__unit')!;
    expect(unit.getAttribute('aria-hidden')).toBe('true');
    expect(unit.textContent).toBe('h');
  });

  it('is not wrapped in a label, because the name is on the control', () => {
    render(<NumberField label="Start offset hours" value={0} onChange={() => {}} unit="h" />);

    expect(hours().closest('label')).toBeNull();
    expect(document.querySelector('label')).toBeNull();
  });

  it('carries the caller bounds and the default step on the native field', () => {
    render(
      <NumberField label="Start offset hours" value={0} min={0} max={23} onChange={() => {}} />,
    );

    expect(hours().getAttribute('min')).toBe('0');
    expect(hours().getAttribute('max')).toBe('23');
    expect(hours().getAttribute('step')).toBe('1');
  });

  it('lets the caller step by something other than one', () => {
    render(
      <NumberField
        label="Start offset hours"
        value={0}
        min={0}
        max={59}
        step={5}
        onChange={() => {}}
      />,
    );

    expect(hours().getAttribute('step')).toBe('5');
  });

  it('reports the number that was typed', () => {
    const onChange = jest.fn();
    render(<NumberField label="Start offset minutes" value={0} onChange={onChange} />);

    fireEvent.change(field('Start offset minutes'), { target: { value: '23' } });

    expect(onChange).toHaveBeenCalledWith(23);
  });

  it('reports null for an emptied field, never a coerced zero', () => {
    const onChange = jest.fn();
    render(<NumberField label="Start offset minutes" value={59} onChange={onChange} />);

    fireEvent.change(field('Start offset minutes'), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith(null);
    expect(onChange).not.toHaveBeenCalledWith(0);
  });

  it('draws the empty state as an empty box, not a zero', () => {
    render(<NumberField label="Start offset hours" value={null} onChange={() => {}} />);

    expect(hours().value).toBe('');
  });

  it('marks a refused value and paints the refusal in the danger ink', () => {
    const { unmount } = render(
      <NumberField label="Start offset hours" value={0} onChange={() => {}} />,
    );
    expect(hours().hasAttribute('aria-invalid')).toBe(false);
    unmount();

    render(<NumberField label="Start offset hours" value={0} onChange={() => {}} invalid />);
    expect(hours().getAttribute('aria-invalid')).toBe('true');
    expect(classesOf(hours())).toContain('border-danger');
    expect(classesOf(hours())).not.toContain('border-line');
  });

  it('disables the control on request', () => {
    render(<NumberField label="Start offset hours" value={0} onChange={() => {}} disabled />);

    expect(hours().disabled).toBe(true);
  });

  it('shares its row: the pair is the flexible child beside the ± discs', () => {
    render(<NumberField label="Start offset hours" value={0} onChange={() => {}} unit="h" />);

    const wrapper = document.querySelector('.ui-number-field')!;
    const classes = classesOf(wrapper);
    expect(classes).toContain('flex-1');
    expect(classes).toContain('min-w-0');
    expect(classes).toContain('gap-[var(--s1)]');
    expect(hours().parentElement).toBe(wrapper);
  });

  it('draws the focus ring and the sunken well through tokens', () => {
    render(<NumberField label="Start offset hours" value={0} onChange={() => {}} />);

    const classes = classesOf(hours());
    expect(classes).toContain('bg-surface-sunken');
    expect(classes).toContain('rounded-[var(--r-sm)]');
    expect(classes).toContain('min-h-[var(--tap)]');
    expect(classes).toContain('focus-visible:outline-[length:var(--focus-ring)]');
    // The ± pair is the only way to step, so the UA's spinner hardware is removed.
    expect(classes).toContain('[appearance:textfield]');
    expect(classes).toContain('[&::-webkit-inner-spin-button]:appearance-none');
  });
});
