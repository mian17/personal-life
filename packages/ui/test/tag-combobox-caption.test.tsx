import { render } from '@testing-library/react';
import { EditorChrome } from '../src/components/editor-chrome';
import { Stack } from '../src/components/stack';
import { TagCombobox } from '../src/components/tag-combobox';

const TAGS = [{ id: 1, name: 'errand' }];

const back = { label: 'Back', onBack: () => {} };

const root = () => document.querySelector('.ui-tag-combobox') as HTMLElement;
const label = () => document.querySelector('.ui-tag-combobox__label') as HTMLElement;
const field = () => document.querySelector('.ui-tag-combobox__field') as HTMLElement;

/** Every class that draws an outer margin on the element itself. */
function marginClasses(node: HTMLElement): string[] {
  return [...node.classList].filter((name) => /^-?m[trblxy]?-/.test(name));
}

/**
 * Spec §5: the caption stacks above the field, one `--s2` under it, and the field adds no gap of
 * its own — the enclosing stack's `--s4` step is what separates it from the next block. jsdom
 * computes no layout, so each relationship is pinned to the class that draws it.
 */
describe('TagCombobox caption spacing', () => {
  it('draws the caption on its own block line, directly above the field', () => {
    render(<TagCombobox tags={TAGS} selectedIds={[]} onToggle={() => {}} />);

    expect(label().classList.contains('block')).toBe(true);
    expect(label().nextElementSibling).toBe(field());
    expect(root().classList.contains('flex-col')).toBe(true);
  });

  it('measures exactly --s2 between the caption and the field', () => {
    render(<TagCombobox tags={TAGS} selectedIds={[]} onToggle={() => {}} />);

    expect(label().classList.contains('mb-[var(--s2)]')).toBe(true);
    // `--s3` was the old create row's gap; it is never a caption gap in this control.
    expect(label().className).not.toContain('--s3');
  });

  it('leaves the gap below the field to the enclosing stack', () => {
    render(
      <EditorChrome back={back} tagPicker={{ tags: TAGS, selectedIds: [], onToggle: () => {} }}>
        <input aria-label="Body" />
      </EditorChrome>,
    );

    const stack = document.querySelector('.ui-editor-stack') as HTMLElement;
    // The chrome's default gap; the control itself draws no outer margin to add to it.
    expect(stack.classList.contains('ui-editor-stack--lg')).toBe(true);
    expect(marginClasses(root())).toEqual([]);
  });

  it('sits one --s4 from the next block on the token stack', () => {
    render(
      <Stack gap="lg">
        <TagCombobox tags={TAGS} selectedIds={[]} onToggle={() => {}} />
        <p className="next-block">Next</p>
      </Stack>,
    );

    const stack = document.querySelector('.ui-stack') as HTMLElement;
    expect(stack.classList.contains('gap-[var(--s4)]')).toBe(true);
    expect(root().nextElementSibling!.classList.contains('next-block')).toBe(true);
    expect(marginClasses(root())).toEqual([]);
  });

  it('never puts the caption back on the chips row', () => {
    render(<TagCombobox tags={TAGS} selectedIds={[1]} onToggle={() => {}} />);

    const chips = document.querySelector('.ui-tag-combobox__chips') as HTMLElement;
    expect(field().contains(chips)).toBe(true);
    expect(label().contains(chips)).toBe(false);
    expect(document.querySelectorAll('.ui-tag-combobox__label')).toHaveLength(1);
    // The old picker's shape: one wrapping row with the caption on the chips' baseline.
    expect(root().classList.contains('items-baseline')).toBe(false);
    expect(root().classList.contains('flex-wrap')).toBe(false);
  });
});
