import { render, screen } from '@testing-library/react';
import { Field } from '../src/components/field';
import { Input } from '../src/components/input';

describe('Field', () => {
  it('renders the caption above the control inside a ui-field block', () => {
    render(
      <Field label="Note">
        <Input aria-label="Todo note" />
      </Field>,
    );
    const block = document.querySelector('.ui-field')!;
    expect(block.tagName).toBe('DIV');
    expect(block.children).toHaveLength(2);
    expect(block.firstElementChild?.tagName).toBe('LABEL');
    expect(block.textContent).toContain('Note');
  });

  it('carries the field rhythm and the caption tier as token utilities', () => {
    render(
      <Field label="Note">
        <Input aria-label="Todo note" />
      </Field>,
    );
    const block = document.querySelector('.ui-field')!;
    expect(block.classList.contains('flex')).toBe(true);
    expect(block.classList.contains('flex-col')).toBe(true);
    expect(block.classList.contains('gap-[var(--s2)]')).toBe(true);

    const label = block.querySelector('.ui-field-label')!;
    expect(label.classList.contains('uppercase')).toBe(true);
    expect(label.classList.contains('text-ink-2')).toBe(true);
    expect(label.classList.contains('text-[length:var(--fs-section-label)]')).toBe(true);
  });

  it('associates the caption with a control through htmlFor', () => {
    render(
      <Field label="Due date" htmlFor="due">
        <Input id="due" />
      </Field>,
    );
    const label = document.querySelector('label')!;
    expect(label.getAttribute('for')).toBe('due');
    expect(screen.getByLabelText('Due date').tagName).toBe('INPUT');
  });

  it('renders no `for` attribute when htmlFor is omitted', () => {
    render(
      <Field label="Note">
        <Input aria-label="Todo note" />
      </Field>,
    );
    expect(document.querySelector('label')!.hasAttribute('for')).toBe(false);
  });

  it('merges className instead of replacing it', () => {
    render(
      <Field label="Note" className="legacy-hook">
        <Input aria-label="Todo note" />
      </Field>,
    );
    const block = document.querySelector('.ui-field')!;
    expect(block.classList.contains('legacy-hook')).toBe(true);
    expect(block.classList.contains('ui-field')).toBe(true);
  });
});
