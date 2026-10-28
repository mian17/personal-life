import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Input } from '../src/components/input';

describe('Input', () => {
  it('renders an <input> carrying the base class', () => {
    render(<Input aria-label="Search" />);
    const input = screen.getByLabelText('Search');
    expect(input.tagName).toBe('INPUT');
    expect(input.classList.contains('ui-input')).toBe(true);
  });

  it('forwards standard form attributes verbatim', () => {
    render(
      <Input
        type="search"
        name="q"
        placeholder="Search notes"
        aria-label="Search notes"
        defaultValue="hello"
      />,
    );
    const input = screen.getByLabelText('Search notes') as HTMLInputElement;
    expect(input.getAttribute('type')).toBe('search');
    expect(input.getAttribute('name')).toBe('q');
    expect(input.getAttribute('placeholder')).toBe('Search notes');
    expect(input.value).toBe('hello');
  });

  it('forwards onChange', () => {
    const onChange = jest.fn();
    render(<Input aria-label="q" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('q'), { target: { value: 'typed' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('merges className instead of replacing it', () => {
    render(<Input aria-label="q" className="legacy-hook" />);
    expect(screen.getByLabelText('q').classList.contains('ui-input')).toBe(true);
    expect(screen.getByLabelText('q').classList.contains('legacy-hook')).toBe(true);
  });

  it('forwards a ref to the rendered element', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input aria-label="q" ref={ref} />);
    expect(ref.current).toBe(screen.getByLabelText('q'));
  });

  /**
   * Regression: Tailwind v4's `outline-none` zeroes `--tw-outline-style`, so
   * `focus-visible:outline-2` alone computes `outline-style: none` and the ring never draws.
   * `focus-visible:outline-solid` must be present to re-arm it.
   */
  it('re-arms the outline style the reset zeroes, so the focused ring draws', () => {
    render(<Input aria-label="q" />);
    const input = screen.getByLabelText('q');
    expect(input.classList.contains('focus-visible:outline-solid')).toBe(true);
    expect(input.classList.contains('focus-visible:outline-[length:var(--focus-ring)]')).toBe(true);
  });
});
