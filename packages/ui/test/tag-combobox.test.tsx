import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { TagCombobox, type TagComboboxProps } from '../src/components/tag-combobox';

/**
 * jsdom has no layout and no `ResizeObserver`; `cmdk`'s list measures itself to publish
 * `--cmdk-list-height`, and the suite is not the judge of a height.
 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const TAGS = [
  { id: 1, name: 'errand' },
  { id: 2, name: 'home' },
  { id: 3, name: 'Home repair' },
];

/** The caller's side of the contract: the chips and the checks follow `selectedIds`, not `onToggle`. */
function Controlled({
  initialSelected = [],
  ...props
}: Readonly<Partial<TagComboboxProps> & { initialSelected?: number[] }> = {}) {
  const [selectedIds, setSelectedIds] = useState<number[]>(initialSelected);
  function toggle(id: number) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((each) => each !== id) : [...prev, id],
    );
  }
  return <TagCombobox tags={TAGS} selectedIds={selectedIds} onToggle={toggle} {...props} />;
}

function setup(overrides: Partial<TagComboboxProps> = {}) {
  const onToggle = jest.fn();
  const view = render(
    <div>
      <TagCombobox tags={TAGS} selectedIds={[]} onToggle={onToggle} {...overrides} />
      <button type="button">Outside</button>
    </div>,
  );
  return { onToggle, view };
}

const trigger = (name = 'Tags') => screen.getByRole('button', { name });
const shell = () => document.querySelector('.ui-tag-combobox__field') as HTMLElement;
const field = () => screen.getByRole('combobox', { name: 'Search tags' }) as HTMLInputElement;
const rows = () => screen.queryAllByRole('option');
const activeRow = () => {
  const id = field().getAttribute('aria-activedescendant');
  return id == null ? null : document.getElementById(id);
};
const chips = () => document.querySelectorAll('.ui-tag-combobox__chips .ui-pill');
const removeButtons = () => screen.queryAllByRole('button', { name: /^Remove / });

function open(overrides: Partial<TagComboboxProps> = {}) {
  const context = setup(overrides);
  fireEvent.click(trigger());
  return context;
}

/** Radix attaches its outside-press listener a tick after the panel mounts. */
async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

beforeEach(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  (Element.prototype as unknown as { scrollIntoView: jest.Mock }).scrollIntoView = jest.fn();
});

describe('TagCombobox', () => {
  it('renders the caption, a closed field and the default strings', () => {
    setup();

    expect(screen.getByText('Tags')).toBeTruthy();
    expect(trigger().getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().getAttribute('aria-controls')).toBeNull();
    expect(trigger().textContent).toContain('Select tags…');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('names the field after the caption, so the chips never leak into the name', () => {
    setup({ selectedIds: [2], label: 'Attached tags' });

    const control = screen.getByRole('button', { name: 'Attached tags' });
    expect(control.getAttribute('aria-labelledby')).toBe(
      document.querySelector('.ui-tag-combobox__label')!.id,
    );
  });

  it('strips one chip per attached tag, however many wrap', () => {
    setup({ selectedIds: [1, 2, 3] });

    expect(chips()).toHaveLength(3);
    expect([...chips()].map((chip) => chip.textContent)).toEqual([
      'errand',
      'home',
      'Home repair',
    ]);
  });

  it('keeps the chips inside the field shell but outside the trigger button', () => {
    setup({ selectedIds: [1, 2] });

    const chipRow = document.querySelector('.ui-tag-combobox__chips')!;
    expect(shell().contains(chipRow)).toBe(true);
    expect(trigger().contains(chipRow)).toBe(false);
    // A button may not nest a button: the chips' own controls stay out of the trigger.
    expect(trigger().textContent).not.toContain('home');
    expect(trigger().getAttribute('aria-labelledby')).toBe(
      document.querySelector('.ui-tag-combobox__label')!.id,
    );
  });

  it('gives every attached chip its own remove control', () => {
    setup({ selectedIds: [1, 2] });

    expect(removeButtons().map((button) => button.getAttribute('aria-label'))).toEqual([
      'Remove errand',
      'Remove home',
    ]);
    expect(shell().contains(removeButtons()[0])).toBe(true);
  });

  it('detaches a tag from its chip control without reopening the panel', () => {
    const { onToggle } = setup({ selectedIds: [2] });

    fireEvent.click(screen.getByRole('button', { name: 'Remove home' }));

    expect(onToggle).toHaveBeenCalledWith(2);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('detaches the chip the caller controls', () => {
    render(<Controlled initialSelected={[2]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove home' }));

    expect(chips()).toHaveLength(0);
    expect(trigger().textContent).toContain('Select tags…');
  });

  it('keeps the panel open when a chip is removed while it is open', async () => {
    render(<Controlled initialSelected={[2]} />);
    fireEvent.click(trigger());
    await settle();

    const remove = screen.getByRole('button', { name: 'Remove home' });
    fireEvent.pointerDown(remove);
    fireEvent.click(remove);
    await settle();

    expect(chips()).toHaveLength(0);
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('hands focus back to the trigger when a removal takes the focus with it', () => {
    render(<Controlled initialSelected={[2]} />);
    const remove = screen.getByRole('button', { name: 'Remove home' });
    remove.focus();

    fireEvent.click(remove);

    expect(screen.queryByRole('button', { name: 'Remove home' })).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('leaves focus where it was when the removal did not hold it', () => {
    setup({ selectedIds: [2] });
    const outside = screen.getByRole('button', { name: 'Outside' });
    outside.focus();

    fireEvent.click(screen.getByRole('button', { name: 'Remove home' }));

    expect(document.activeElement).toBe(outside);
  });

  it('offers no field at all when the caller has no tags', () => {
    setup({ tags: [] });

    expect((trigger() as HTMLButtonElement).disabled).toBe(true);
    expect(trigger().textContent).toContain('No tags yet');
    fireEvent.click(trigger());
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('honours the disabled flag', () => {
    setup({ disabled: true });

    expect((trigger() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(trigger());
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('opens a listbox as wide as the trigger, named after the caption', () => {
    open();

    const listbox = screen.getByRole('listbox');
    expect(listbox.getAttribute('aria-label')).toBe('Tags');
    expect(listbox.getAttribute('aria-multiselectable')).toBe('true');
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-controls')).toBe(listbox.id);
    expect(rows()).toHaveLength(3);
  });

  it('opens unchosen, so a bare Enter toggles nothing', () => {
    const { onToggle } = open();

    expect(rows().every((row) => row.getAttribute('aria-selected') === 'false')).toBe(true);
    fireEvent.keyDown(field(), { key: 'Enter' });

    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('walks the rows with the arrows, Home and End and names the walked row on the field', () => {
    open();

    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(activeRow()).toBe(rows()[0]);
    expect(rows()[0].getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(field(), { key: 'End' });
    expect(activeRow()).toBe(rows()[2]);

    fireEvent.keyDown(field(), { key: 'Home' });
    expect(activeRow()).toBe(rows()[0]);

    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    expect(activeRow()).toBe(rows()[0]);
  });

  it('toggles the walked row on Enter and keeps the panel open', () => {
    const { onToggle } = open();

    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(field(), { key: 'Enter' });

    expect(onToggle).toHaveBeenCalledWith(1);
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('toggles the walked row on Space', () => {
    const { onToggle } = open();

    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(field(), { key: ' ' });

    expect(onToggle).toHaveBeenCalledWith(1);
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('leaves Space to the search field when no row is walked', () => {
    const { onToggle } = open();

    // Not prevented, so the field keeps the character: two-word tags must be searchable.
    expect(fireEvent.keyDown(field(), { key: ' ' })).toBe(true);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('toggles on a row press without losing the search field', () => {
    const { onToggle } = open();
    field().focus();

    const row = rows()[1];
    expect(fireEvent.pointerDown(row)).toBe(false);
    fireEvent.click(row);

    expect(onToggle).toHaveBeenCalledWith(2);
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(document.activeElement).toBe(field());
  });

  it('closes on Escape and hands focus back to the field', async () => {
    open();

    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();

    await settle();
    expect(document.activeElement).toBe(trigger());
  });

  it('closes on a press outside and hands focus back to the field', async () => {
    open();
    await settle();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    await settle();

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('stays open on a press of the open trigger, which closes it instead', async () => {
    open();
    await settle();

    fireEvent.pointerDown(trigger());
    fireEvent.click(trigger());

    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes on Tab and lets focus move onward', async () => {
    const { onToggle } = open();

    fireEvent.keyDown(field(), { key: 'Tab' });
    // What the browser does next; jsdom dispatches no default Tab.
    act(() => screen.getByRole('button', { name: 'Outside' }).focus());
    await settle();

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onToggle).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Outside' }));
  });

  it('filters the rows by name, case-insensitively, and says when nothing matches', () => {
    open();

    fireEvent.change(field(), { target: { value: 'home' } });
    expect(rows().map((row) => row.textContent)).toEqual(['home', 'Home repair']);

    fireEvent.change(field(), { target: { value: 'zzz' } });
    expect(rows()).toHaveLength(0);
    expect(screen.getByText('No tags match.')).toBeTruthy();
  });

  it('starts every open unchosen and unfiltered', async () => {
    open();
    fireEvent.change(field(), { target: { value: 'errand' } });
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(field(), { key: 'Escape' });
    await settle();

    fireEvent.click(trigger());

    expect(field().value).toBe('');
    expect(rows()).toHaveLength(3);
    expect(rows()[0].getAttribute('aria-selected')).toBe('false');
  });

  it('moves the check mark and the chips with the selection, detaching the last tag', () => {
    render(<Controlled />);
    fireEvent.click(trigger());
    expect(rows()[1].getAttribute('aria-checked')).toBe('false');

    fireEvent.click(rows()[1]);
    expect(rows()[1].getAttribute('aria-checked')).toBe('true');
    expect(chips()).toHaveLength(1);
    expect(chips()[0].textContent).toContain('home');

    fireEvent.click(rows()[1]);
    expect(rows()[1].getAttribute('aria-checked')).toBe('false');
    expect(chips()).toHaveLength(0);
    expect(trigger().textContent).toContain('Select tags…');
  });

  it('merges className instead of replacing it', () => {
    setup({ className: 'legacy-hook' });

    expect(
      document.querySelector('.ui-tag-combobox')!.classList.contains('legacy-hook'),
    ).toBe(true);
  });

  it('declares no raw colour or length of its own', () => {
    const source = readFileSync(
      join(__dirname, '..', 'src', 'components', 'tag-combobox.tsx'),
      'utf8',
    );

    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/rgba?\(/);
    expect(source).not.toMatch(/\d+px\b/);
  });
});
