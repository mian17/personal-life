import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Autosuggest } from '../src/components/autosuggest';
import type { AutosuggestOption, AutosuggestProps } from '../src/components/autosuggest';

// jsdom 20 has no `showPopover`/`hidePopover` (where the popup lands is the
// browser's business); the suite stubs them so the component's call order is
// observable, the same way the Dialog suite stubs `showModal`/`close`.
type PopoverStub = { showPopover: jest.Mock; hidePopover: jest.Mock };

const OPTIONS: AutosuggestOption[] = [
  { id: 'apple', label: 'Apple', meta: 'per 100 g · 52 kcal' },
  { id: 'banana', label: 'Banana' },
  { id: 'cherry', label: 'Cherry' },
];

const showPopover = jest.fn();
const hidePopover = jest.fn();
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

function rowItems() {
  return screen.getAllByRole('option');
}

beforeEach(() => {
  showPopover.mockClear();
  hidePopover.mockClear();
  scrollIntoView.mockClear();
  (HTMLElement.prototype as unknown as PopoverStub).showPopover = showPopover;
  (HTMLElement.prototype as unknown as PopoverStub).hidePopover = hidePopover;
  // jsdom has no layout; the block still has to ask the browser to keep the
  // highlighted row on screen, so the call is what the suite can observe.
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
    expect(input.getAttribute('aria-controls')).toBeTruthy();
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(showPopover).not.toHaveBeenCalled();
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
    expect(rowItems()).toHaveLength(3);
    expect(screen.getByText('per 100 g · 52 kcal')).toBeTruthy();
  });

  it('lifts the list into the top layer as a native popover', () => {
    const { input, view } = setup();

    type(input, 'app');
    const popup = screen.getByRole('listbox');
    expect(popup.getAttribute('popover')).toBe('manual');
    expect(showPopover).toHaveBeenCalledTimes(1);
    expect(showPopover.mock.contexts[0]).toBe(popup);

    view.unmount();
    expect(hidePopover).toHaveBeenCalledTimes(1);
    expect(hidePopover.mock.contexts[0]).toBe(popup);
  });

  it('wires the list and its rows to the field', () => {
    const { input } = setup();

    type(input, 'app');
    const popup = screen.getByRole('listbox');
    const rows = rowItems();

    expect(popup.id).toBe(input.getAttribute('aria-controls'));
    expect(rows.map((row) => row.id)).toEqual([
      `${popup.id}-option-0`,
      `${popup.id}-option-1`,
      `${popup.id}-option-2`,
    ]);
    expect(rows.map((row) => row.getAttribute('aria-selected'))).toEqual(['false', 'false', 'false']);
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

  it('moves the highlight on ArrowDown/ArrowUp and clamps at both ends', () => {
    const { input } = setup();

    type(input, 'app');
    const rows = rowItems();

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(rows[0].id);
    expect(rows[0].getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(rows[2].id);
    expect(rows[2].getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.getAttribute('aria-activedescendant')).toBe(rows[0].id);
  });

  it('jumps to the first and last option on Home and End', () => {
    const { input } = setup();

    type(input, 'app');
    const rows = rowItems();

    fireEvent.keyDown(input, { key: 'End' });
    expect(input.getAttribute('aria-activedescendant')).toBe(rows[2].id);

    fireEvent.keyDown(input, { key: 'Home' });
    expect(input.getAttribute('aria-activedescendant')).toBe(rows[0].id);
  });

  it('reopens a dismissed list on ArrowDown with the first option highlighted', () => {
    const { input } = setup();

    type(input, 'app');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const rows = rowItems();
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(input.getAttribute('aria-activedescendant')).toBe(rows[0].id);
  });

  it('opens on Alt+ArrowDown without highlighting', () => {
    const { input } = setup();

    type(input, 'app');
    fireEvent.keyDown(input, { key: 'Escape' });

    fireEvent.keyDown(input, { key: 'ArrowDown', altKey: true });
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
  });

  it('drops the highlight when the query changes', () => {
    const { input } = setup();

    type(input, 'app');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).not.toBeNull();

    type(input, 'appl');
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
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

  it('clears synchronously while a report is pending', () => {
    jest.useFakeTimers();
    const { input, onQueryChange } = setup({ debounceMs: 300 });

    type(input, 'app');
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.keyDown(input, { key: 'Escape' });

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
    const row = rowItems()[1];

    expect(row.querySelector('button, a, input')).toBeNull();
    // preventDefault on the pointer press is what keeps the field focused.
    expect(fireEvent.mouseDown(row)).toBe(false);
    expect(fireEvent.pointerDown(row)).toBe(false);
    fireEvent.click(row);

    expect(onSelect).toHaveBeenCalledWith(OPTIONS[1]);
    expect(document.activeElement).toBe(input);
  });

  it('keeps the query and the list open when clearOnSelect is false', () => {
    const { input, onSelect } = setup({ clearOnSelect: false });

    type(input, 'app');
    fireEvent.click(rowItems()[0]);

    expect(onSelect).toHaveBeenCalledWith(OPTIONS[0]);
    expect(input.value).toBe('app');
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('shows emptyLabel when nothing matches a long-enough query', () => {
    const { input } = setup({ options: [], emptyLabel: 'No foods match' });

    type(input, 'app');

    expect(screen.getByText('No foods match')).toBeTruthy();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('shows no list at all without emptyLabel when nothing matches', () => {
    const { input } = setup({ options: [] });

    type(input, 'app');

    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('caps the visible rows through the caller\'s maxVisible', () => {
    const { input } = setup({ maxVisible: 5 });

    type(input, 'app');
    const popup = screen.getByRole('listbox');

    expect(popup.style.getPropertyValue('--ui-autosuggest-rows')).toBe('5');
    expect(rowItems()).toHaveLength(3);

    // The cap is CSS: the popup is `maxVisible` rows tall, then scrolls.
    const css = readFileSync(join(__dirname, '..', 'src', 'styles', 'blocks.css'), 'utf8');
    const rule = css.slice(css.indexOf('.ui-autosuggest__popup {'));
    const body = rule.slice(0, rule.indexOf('}'));
    expect(body).toContain('var(--ui-autosuggest-rows, 8)');
    expect(body).toContain('overflow-y: auto');
  });

  it('scrolls the highlighted row into view as the highlight moves', () => {
    const { input } = setup({ maxVisible: 2 });
    type(input, 'app');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(rowItems()[1]);
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
});
