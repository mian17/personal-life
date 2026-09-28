import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { TagPicker, type TagOption } from '../src/components/tag-picker';

const TAGS: TagOption[] = [
  { id: 1, name: 'errand' },
  { id: 2, name: 'home' },
];

describe('TagPicker', () => {
  it('renders a labelled group with one toggle button per tag', () => {
    render(<TagPicker tags={TAGS} selectedIds={[]} onToggle={() => {}} />);
    const group = screen.getByRole('group', { name: 'Tags' });
    expect(group.tagName).toBe('DIV');
    expect(screen.getByRole('button', { name: 'errand' }).tagName).toBe('BUTTON');
    expect(screen.getByRole('button', { name: 'home' }).tagName).toBe('BUTTON');
  });

  it('marks selected tags with the active modifier and aria-pressed', () => {
    render(<TagPicker tags={TAGS} selectedIds={[2]} onToggle={() => {}} />);
    const selected = screen.getByRole('button', { name: 'home' });
    const unselected = screen.getByRole('button', { name: 'errand' });
    expect(selected.getAttribute('aria-pressed')).toBe('true');
    expect(selected.classList.contains('ui-pill--active')).toBe(true);
    expect(unselected.getAttribute('aria-pressed')).toBe('false');
    expect(unselected.classList.contains('ui-pill--active')).toBe(false);
  });

  it('toggles a tag by id', () => {
    const onToggle = jest.fn();
    render(<TagPicker tags={TAGS} selectedIds={[]} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'errand' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(1);
  });

  it('renders no create affordance without onCreate', () => {
    render(<TagPicker tags={TAGS} selectedIds={[]} onToggle={() => {}} />);
    expect(screen.queryByLabelText('New tag')).toBeNull();
  });

  it('creates a trimmed tag name and clears the draft', () => {
    const onCreate = jest.fn();
    render(
      <TagPicker tags={TAGS} selectedIds={[]} onToggle={() => {}} onCreate={onCreate} />,
    );
    const input = screen.getByLabelText('New tag') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  errand  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    expect(onCreate).toHaveBeenCalledWith('errand');
    expect(input.value).toBe('');
  });

  it('creates on Enter', () => {
    const onCreate = jest.fn();
    render(
      <TagPicker tags={TAGS} selectedIds={[]} onToggle={() => {}} onCreate={onCreate} />,
    );
    const input = screen.getByLabelText('New tag');
    fireEvent.change(input, { target: { value: 'home' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCreate).toHaveBeenCalledWith('home');
  });

  it('never creates from an empty or whitespace-only name', () => {
    const onCreate = jest.fn();
    render(
      <TagPicker tags={TAGS} selectedIds={[]} onToggle={() => {}} onCreate={onCreate} />,
    );
    const input = screen.getByLabelText('New tag') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    expect(onCreate).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Add tag' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('passes a long name through verbatim (trimmed)', () => {
    const onCreate = jest.fn();
    const long = ` ${'x'.repeat(300)} `;
    render(
      <TagPicker tags={TAGS} selectedIds={[]} onToggle={() => {}} onCreate={onCreate} />,
    );
    const input = screen.getByLabelText('New tag');
    fireEvent.change(input, { target: { value: long } });
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    expect(onCreate).toHaveBeenCalledWith('x'.repeat(300));
  });

  it('honours the disabled flag on every control', () => {
    render(<TagPicker tags={TAGS} selectedIds={[]} onToggle={() => {}} onCreate={() => {}} disabled />);
    expect((screen.getByRole('button', { name: 'errand' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Add tag' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('New tag') as HTMLInputElement).disabled).toBe(true);
  });

  it('accepts label, placeholder and createLabel overrides', () => {
    render(
      <TagPicker
        tags={TAGS}
        selectedIds={[]}
        onToggle={() => {}}
        onCreate={() => {}}
        label="Labels"
        placeholder="New label"
        createLabel="Add label"
      />,
    );
    expect(screen.getByRole('group', { name: 'Labels' })).toBeTruthy();
    expect(screen.getByLabelText('New label')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add label' })).toBeTruthy();
  });

  it('merges className instead of replacing it', () => {
    render(
      <TagPicker tags={TAGS} selectedIds={[]} onToggle={() => {}} className="legacy-hook" />,
    );
    expect(screen.getByRole('group', { name: 'Tags' }).classList.contains('legacy-hook')).toBe(
      true,
    );
  });

  it('contains zero data fetching', () => {
    const source = readFileSync(
      join(__dirname, '..', 'src', 'components', 'tag-picker.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/fetch\(/);
    expect(source).not.toMatch(/next\/navigation/);
  });
});
