import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Input } from '../src/components/input';

describe('Input', () => {
  it('renders an <input> carrying the base class', () => {
    render(<Input aria-label="Search" />);
    const input = screen.getByLabelText('Search');
    expect(input.tagName).toBe('INPUT');
    expect(input.className.split(/\s+/).filter(Boolean)).toEqual(['ui-input']);
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
    expect(screen.getByLabelText('q').className.split(/\s+/).filter(Boolean)).toEqual([
      'ui-input',
      'legacy-hook',
    ]);
  });

  it('forwards a ref to the rendered element', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input aria-label="q" ref={ref} />);
    expect(ref.current).toBe(screen.getByLabelText('q'));
  });
});
