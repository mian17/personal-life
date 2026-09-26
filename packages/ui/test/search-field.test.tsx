import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SearchField } from '../src/components/search-field';

describe('SearchField', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function setup(value?: string) {
    const onQueryChange = jest.fn();
    const view = render(
      <SearchField
        label="Search notes"
        placeholder="Search notes"
        value={value}
        onQueryChange={onQueryChange}
      />,
    );
    const input = screen.getByRole('searchbox', { name: 'Search notes' }) as HTMLInputElement;
    return { onQueryChange, input, view };
  }

  it('renders the ui-search-box wrapper around a labelled search input', () => {
    const { input } = setup();
    const box = document.querySelector('.ui-search-box')!;
    expect(box.tagName).toBe('DIV');
    expect(box.contains(input)).toBe(true);
    expect(input.getAttribute('type')).toBe('search');
    expect(input.getAttribute('aria-label')).toBe('Search notes');
    expect(input.getAttribute('placeholder')).toBe('Search notes');
  });

  it('debounces onQueryChange by 300ms, emitting once with the latest value', () => {
    const { onQueryChange, input } = setup();
    fireEvent.change(input, { target: { value: 'm' } });
    fireEvent.change(input, { target: { value: 'mi' } });
    act(() => {
      jest.advanceTimersByTime(299);
    });
    expect(onQueryChange).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(onQueryChange).toHaveBeenCalledTimes(1);
    expect(onQueryChange).toHaveBeenCalledWith('mi');
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(onQueryChange).toHaveBeenCalledTimes(1);
  });

  it('does not emit on mount', () => {
    const { onQueryChange } = setup('seed');
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(onQueryChange).not.toHaveBeenCalled();
  });

  it('reflects a controlled value and re-syncs when the parent changes it', () => {
    const { onQueryChange, input, view } = setup('alpha');
    expect(input.value).toBe('alpha');
    act(() => {
      view.rerender(
        <SearchField
          label="Search notes"
          placeholder="Search notes"
          value="beta"
          onQueryChange={onQueryChange}
        />,
      );
    });
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('beta');
  });

  it('still emits after a controlled value is supplied', () => {
    const { onQueryChange, input } = setup('alpha');
    fireEvent.change(input, { target: { value: 'alphabet' } });
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(onQueryChange).toHaveBeenCalledWith('alphabet');
  });

  it('contains zero routing knowledge', () => {
    const source = readFileSync(
      join(__dirname, '..', 'src', 'components', 'search-field.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/next\/navigation/);
    expect(source).not.toMatch(/\brouter\b/i);
    expect(source).not.toMatch(/fetch\(/);
    expect(source).not.toMatch(/location\./);
  });
});
