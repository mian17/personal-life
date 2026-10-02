import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Select } from '../src/components/select';

const OPTIONS = [
  { value: '', label: 'None' },
  { value: 'weekly', label: 'Weekly (Thursday)' },
  { value: 'monthly', label: 'Monthly (The 1st day)' },
];

describe('Select', () => {
  it('renders a <select> carrying the base class with its options', () => {
    render(<Select aria-label="Repeat" options={OPTIONS} defaultValue="weekly" />);
    const select = screen.getByLabelText('Repeat') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(select.className.split(/\s+/).filter(Boolean)).toEqual(['ui-select']);
    expect(select.value).toBe('weekly');
    expect(screen.getByRole('option', { name: 'None' })).toBeDefined();
    expect(select.options).toHaveLength(3);
  });

  it('is single-select by construction', () => {
    render(<Select aria-label="Repeat" options={OPTIONS} />);
    const select = screen.getByLabelText('Repeat') as HTMLSelectElement;
    expect(select.multiple).toBe(false);
  });

  it('forwards standard form attributes and onChange', () => {
    const onChange = jest.fn();
    render(<Select aria-label="List" name="listId" options={OPTIONS} onChange={onChange} />);
    const select = screen.getByLabelText('List') as HTMLSelectElement;
    expect(select.getAttribute('name')).toBe('listId');
    fireEvent.change(select, { target: { value: 'monthly' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('merges className instead of replacing it', () => {
    render(<Select aria-label="Repeat" options={OPTIONS} className="legacy-hook" />);
    expect(screen.getByLabelText('Repeat').className.split(/\s+/).filter(Boolean)).toEqual([
      'ui-select',
      'legacy-hook',
    ]);
  });

  it('forwards a ref to the rendered element', () => {
    const ref = createRef<HTMLSelectElement>();
    render(<Select aria-label="Repeat" options={OPTIONS} ref={ref} />);
    expect(ref.current).toBe(screen.getByLabelText('Repeat'));
  });
});
