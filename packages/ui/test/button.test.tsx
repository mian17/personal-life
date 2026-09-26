import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Button, type ButtonVariant } from '../src/components/button';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('Button', () => {
  it('renders a <button> and defaults to primary/default', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button');
    expect(button.tagName).toBe('BUTTON');
    expect(button.textContent).toBe('Save');
    expect(classesOf(button)).toEqual(['ui-btn', 'ui-btn--default', 'ui-btn--primary'].sort());
  });

  it.each<ButtonVariant>(['primary', 'ghost', 'danger', 'quiet'])(
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
});
