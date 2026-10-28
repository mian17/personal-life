import { act, fireEvent, render, screen } from '@testing-library/react';
import { Autosuggest } from '../src/components/autosuggest';
import type { AutosuggestOption, AutosuggestProps } from '../src/components/autosuggest';

/**
 * jsdom has no layout and no `ResizeObserver`; `cmdk`'s list measures itself to publish
 * `--cmdk-list-height`, and the suite is not the judge of a height.
 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const OPTIONS: AutosuggestOption[] = [
  { id: 'apple', label: 'Apple', meta: 'per 100 g · 52 kcal' },
  { id: 'banana', label: 'Banana' },
  { id: 'cherry', label: 'Cherry' },
];

const scrollIntoView = jest.fn();

function setup(overrides: Partial<AutosuggestProps> = {}) {
  const onQueryChange = jest.fn();
  const onSelect = jest.fn();
  const view = render(
    <Autosuggest
      options={OPTIONS}
      onQueryChange={onQueryChange}
      onSelect={onSelect}
      label="Search foods"
      {...overrides}
    />,
  );
  const input = screen.getByRole('combobox', { name: 'Search foods' }) as HTMLInputElement;
  return { onQueryChange, onSelect, input, view };
}

function type(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

function rows() {
  return screen.queryAllByRole('option');
}

/** The row `aria-activedescendant` points at: the highlight `cmdk` owns and the field names. */
function activeRow(input: HTMLInputElement) {
  const id = input.getAttribute('aria-activedescendant');
  return id == null ? null : document.getElementById(id);
}

beforeEach(() => {
  scrollIntoView.mockClear();
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  (Element.prototype as unknown as { scrollIntoView: jest.Mock }).scrollIntoView = scrollIntoView;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Autosuggest', () => {
  it('renders a labelled combobox with the list closed', () => {
    const { input } = setup();

    expect(input.value).toBe('');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('stays closed and reports "" below minChars', () => {
    const { input, onQueryChange } = setup();

    type(input, 'ap');

    expect(onQueryChange).toHaveBeenLastCalledWith('');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens and reports the trimmed query at minChars', () => {
    const { input, onQueryChange } = setup();

    type(input, '  app  ');

    expect(onQueryChange).toHaveBeenLastCalledWith('app');
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-controls')).toBe(screen.getByRole('listbox').id);
    expect(rows()).toHaveLength(3);
    expect(screen.getByText('per 100 g · 52 kcal')).toBeTruthy();
  });

  it('reports every keystroke immediately at the default debounce', () => {
    const { input, onQueryChange } = setup();

    type(input, 'app');
    type(input, 'appl');

    expect(onQueryChange.mock.calls).toEqual([['app'], ['appl']]);
  });

  it('delays the report and fires only the latest query when debounced', () => {
    jest.useFakeTimers();
    const { input, onQueryChange } = setup({ debounceMs: 300 });

    type(input, 'app');
    type(input, 'appl');
    expect(onQueryChange).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(299);
    });
    expect(onQueryChange).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(onQueryChange.mock.calls).toEqual([['appl']]);
  });

  it('drops the pending report when the text falls back below minChars', () => {
    jest.useFakeTimers();
    const { input, onQueryChange } = setup({ debounceMs: 300 });

    type(input, 'app');
    type(input, 'ap');

    expect(onQueryChange.mock.calls).toEqual([['']]);
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(onQueryChange.mock.calls).toEqual([['']]);
  });

  it('reports nothing after unmount', () => {
    jest.useFakeTimers();
    const { input, onQueryChange, view } = setup({ debounceMs: 300 });

    type(input, 'app');
    view.unmount();
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(onQueryChange).not.toHaveBeenCalled();
  });

  it('opens with no highlight, then moves it on ArrowDown/ArrowUp and clamps at both ends', () => {
    const { input } = setup();

    type(input, 'app');
    expect(activeRow(input)).toBeNull();

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(activeRow(input)).toBe(rows()[0]);
    expect(rows()[0].getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(activeRow(input)).toBe(rows()[2]);
    expect(rows()[2].getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(activeRow(input)).toBe(rows()[0]);
  });

  it('jumps to the first and last option on Home and End', () => {
    const { input } = setup();

    type(input, 'app');
    fireEvent.keyDown(input, { key: 'End' });
    expect(activeRow(input)).toBe(rows()[2]);

    fireEvent.keyDown(input, { key: 'Home' });
    expect(activeRow(input)).toBe(rows()[0]);
  });

  it('reopens a dismissed list on ArrowDown with the first option highlighted', () => {
    const { input } = setup();

    type(input, 'app');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.keyDown(input, { key: 'ArrowDown' });

    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(activeRow(input)).toBe(rows()[0]);
  });

  it('opens on Alt+ArrowDown without highlighting', () => {
    const { input } = setup();

    type(input, 'app');
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.keyDown(input, { key: 'ArrowDown', altKey: true });

    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(activeRow(input)).toBeNull();
    expect(input.value).toBe('app');
  });

  it('drops the highlight when the query changes', () => {
    const { input } = setup();

    type(input, 'app');
    fireEvent.keyDown(input, { key: 'End' });
    expect(activeRow(input)).not.toBeNull();

    type(input, 'appl');
    expect(activeRow(input)).toBeNull();
  });

  it('selects the highlighted option on Enter and clears the field', () => {
    const { input, onQueryChange, onSelect } = setup();

    type(input, 'app');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith(OPTIONS[0]);
    expect(input.value).toBe('');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onQueryChange).toHaveBeenLastCalledWith('');
  });

  it('ignores Enter with no highlight', () => {
    const { input, onSelect } = setup();

    type(input, 'app');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('accepts the highlight on Tab and closes the list', () => {
    const { input, onSelect } = setup();

    type(input, 'app');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Tab' });

    expect(onSelect).toHaveBeenCalledWith(OPTIONS[0]);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('clears the field on the Escape that finds the list already closed', () => {
    const { input, onQueryChange } = setup();

    type(input, 'app');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('app');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('');
    expect(onQueryChange).toHaveBeenLastCalledWith('');
  });

  it('clears synchronously and drops the pending report', () => {
    jest.useFakeTimers();
    const { input, onQueryChange } = setup({ debounceMs: 300 });

    type(input, 'app');
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(input.value).toBe('');
    expect(onQueryChange.mock.calls).toEqual([['']]);
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(onQueryChange.mock.calls).toEqual([['']]);
  });

  it('selects on a row click without the field losing focus', () => {
    const { input, onSelect } = setup();

    input.focus();
    type(input, 'app');
    const row = rows()[1];

    // preventDefault on the pointer press is what keeps the field focused.
    expect(fireEvent.pointerDown(row)).toBe(false);
    fireEvent.click(row);

    expect(onSelect).toHaveBeenCalledWith(OPTIONS[1]);
    expect(document.activeElement).toBe(input);
  });

  it('keeps the query and the list open when clearOnSelect is false', () => {
    const { input, onSelect } = setup({ clearOnSelect: false });

    type(input, 'app');
    fireEvent.click(rows()[0]);

    expect(onSelect).toHaveBeenCalledWith(OPTIONS[0]);
    expect(input.value).toBe('app');
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('shows emptyLabel when nothing matches a long-enough query', () => {
    const { input } = setup({ options: [], emptyLabel: 'No foods match' });

    type(input, 'app');

    expect(screen.getByText('No foods match')).toBeTruthy();
    expect(rows()).toHaveLength(0);
  });

  it('shows no list at all without emptyLabel when nothing matches', () => {
    const { input } = setup({ options: [] });

    type(input, 'app');

    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('hands the caller\'s maxVisible to the list as its row cap', () => {
    const { input } = setup({ maxVisible: 5 });

    type(input, 'app');
    const list = screen.getByRole('listbox');

    expect(list.style.getPropertyValue('--autosuggest-rows')).toBe('5');
    expect(rows()).toHaveLength(3);
  });

  it('scrolls the highlighted row into view as the highlight moves', () => {
    const { input } = setup({ maxVisible: 2 });
    type(input, 'app');

    fireEvent.keyDown(input, { key: 'ArrowDown' });

    expect(scrollIntoView).toHaveBeenCalled();
    expect(scrollIntoView.mock.calls.at(-1)![0]).toEqual({ block: 'nearest' });
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(rows()[0]);
  });

  it('dismisses on a pointer outside the popup and the field, keeping the text', () => {
    const { input } = setup();
    type(input, 'app');
    expect(screen.getByRole('listbox')).toBeTruthy();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input.value).toBe('app');
  });

  it('stays open on a pointer on the field itself', () => {
    const { input } = setup();
    type(input, 'app');

    fireEvent.pointerDown(input);

    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('reopens the list when the field is pressed again after a pointer outside dismissed it', () => {
    const { input } = setup();
    type(input, 'app');

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.pointerDown(input);

    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(input.value).toBe('app');

    // the press reset still respects minChars
    type(input, 'ap');
    fireEvent.pointerDown(input);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('reopens the list when the field regains focus after Escape dismissed it', () => {
    const { input } = setup();
    type(input, 'app');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();

    input.blur();
    act(() => input.focus());

    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(input.value).toBe('app');
  });
});
