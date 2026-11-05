import { fireEvent, render, screen } from '@testing-library/react';
import { Checkbox } from '../src/components/checkbox';

/**
 * The mark's corner is a row-supplied hook, like its size: `--checkbox-radius` when a row states
 * one, `.check__box`'s own `--r-sm` otherwise. A fixed 8px corner cannot survive the narrowing —
 * on a dense row's 12px mark it clamps to 6px, half the box, and the mark paints as a disc.
 */
const MARK_CORNER = 'rounded-[var(--checkbox-radius,var(--r-sm))]';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('Checkbox', () => {
  it('renders the registry root as a checkbox control, unchecked by default', () => {
    render(<Checkbox />);
    const box = screen.getByRole('checkbox');
    expect(box.tagName).toBe('BUTTON');
    expect(box.getAttribute('type')).toBe('button');
    expect(box.getAttribute('aria-checked')).toBe('false');
    expect(box.classList.contains('ui-checkbox')).toBe(true);
    expect(box.classList.contains('ui-checkbox--checked')).toBe(false);
    // The registry indicator is presence-driven: an unchecked box draws no glyph.
    expect(box.querySelector('.ui-checkbox__glyph')).toBeNull();
  });

  it('adds the checked modifier and the checked root state when checked', () => {
    render(<Checkbox checked />);
    const box = screen.getByRole('checkbox');
    expect(box.getAttribute('aria-checked')).toBe('true');
    expect(box.getAttribute('data-state')).toBe('checked');
    expect(box.classList.contains('ui-checkbox--checked')).toBe(true);
    expect(box.querySelector('.ui-checkbox__box')!.classList.contains('group-data-[state=checked]:bg-max')).toBe(
      true,
    );
    expect(box.querySelector('.ui-checkbox__glyph')).not.toBeNull();
  });

  it('carries its accessible name from label as aria-label', () => {
    render(<Checkbox label="Mark Buy milk done" />);
    expect(screen.getByRole('checkbox').getAttribute('aria-label')).toBe('Mark Buy milk done');
  });

  it('merges className instead of replacing it', () => {
    render(<Checkbox className="legacy-hook" />);
    const box = screen.getByRole('checkbox');
    expect(box.classList.contains('legacy-hook')).toBe(true);
    expect(box.classList.contains('ui-checkbox')).toBe(true);
  });

  it('reports the user toggle through onCheckedChange, not through its own state', () => {
    const onCheckedChange = jest.fn();
    render(<Checkbox checked={false} onCheckedChange={onCheckedChange} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('paints the mark inside a 48px target that bleeds §8\u2019s row offsets, so it adds no row height', () => {
    render(<Checkbox />);
    const target = classesOf(screen.getByRole('checkbox'));
    expect(target.filter((name) => name.startsWith('size-['))).toEqual(['size-[var(--tap)]']);
    expect(target).toContain('rounded-[var(--r-md)]');
    expect(target).toContain('active:bg-press');
    expect(target).not.toContain('size-[var(--leading)]');
    // §8's `.check` carries negative block/start offsets; without them a 48px target would
    // push the row it sits in taller than the row's own content.
    expect(target).toContain('-my-[var(--s2)]');
    expect(target).toContain('-ms-[var(--s3)]');
  });

  it('sizes and rounds the square through the checkbox-size token on the strong hairline', () => {
    render(<Checkbox />);
    const box = classesOf(screen.getByRole('checkbox').querySelector('.ui-checkbox__box')!);
    expect(box.filter((name) => name.startsWith('size-['))).toEqual(['size-[var(--checkbox-size)]']);
    expect(box).toContain(MARK_CORNER);
    // The mark rides the strong hairline on the surface; the accent only fills it when checked.
    expect(box).toContain('border-line-strong');
    expect(box).toContain('bg-surface');
    // §8 draws `.check__box` unpadded: its border box is the whole budget the glyph is drawn in.
    expect(box.filter((name) => /^p[xytblrse]?-/.test(name))).toEqual([]);
  });

  it('takes its corner from a row-supplied hook, defaulting to the box radius', () => {
    render(<Checkbox />);
    const box = classesOf(screen.getByRole('checkbox').querySelector('.ui-checkbox__box')!);
    // The fallback keeps a row that states no corner exactly where §8 drew it (8px on 24px);
    // a row that narrows the mark states a corner that still reads as a box, not a disc.
    expect(box).toContain(MARK_CORNER);
    expect(box).not.toContain('rounded-[var(--r-sm)]');
  });

  it('clamps the glyph to the box it is drawn in, so a narrowed box cannot overflow', () => {
    render(<Checkbox checked />);
    const glyph = screen.getByRole('checkbox').querySelector('.ui-checkbox__glyph')!;
    // The indicator fills the box's content area, and the glyph is `min(16px, 100%)` of it:
    // §8's 16px-inside-24px pairing at the default hook, clamped to the box when a dense row
    // narrows `--checkbox-size` below the glyph's own size.
    expect(classesOf(glyph)).toContain('place-content-center');
    expect(classesOf(glyph)).toContain('size-full');
    const glyphClass = glyph.querySelector('svg')!.getAttribute('class') ?? '';
    expect(glyphClass.split(/\s+/)).toContain('size-[min(var(--s4),100%)]');
  });
});
