import { fireEvent, render, screen } from '@testing-library/react';
import { IconButton } from '../src/components/icon-button';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

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

  it('uses only the base class for the default variant', () => {
    render(<IconButton label="Back">{<span />}</IconButton>);
    expect(classesOf(screen.getByRole('button'))).toEqual(['ui-icon-btn']);
  });

  it('adds the variant modifier for non-default variants', () => {
    render(
      <IconButton label="Back" variant="ghost">
        {<span />}
      </IconButton>,
    );
    expect(classesOf(screen.getByRole('button'))).toEqual(['ui-icon-btn', 'ui-icon-btn--ghost']);
  });

  it('merges className instead of replacing it', () => {
    render(
      <IconButton label="Save" className="legacy-hook">
        {<span />}
      </IconButton>,
    );
    expect(classesOf(screen.getByRole('button'))).toEqual([
      'legacy-hook',
      'ui-icon-btn',
    ]);
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
});
