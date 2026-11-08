import { fireEvent, render, screen } from '@testing-library/react';
import { Pill, type PillSize, type PillTag } from '../src/components/pill';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('Pill', () => {
  it('renders a <span> chip by default', () => {
    render(<Pill>Tag</Pill>);
    const chip = screen.getByText('Tag');
    expect(chip.tagName).toBe('SPAN');
    expect(chip.classList.contains('ui-pill')).toBe(true);
    expect(chip.classList.contains('ui-pill--chip')).toBe(true);
  });

  it.each<PillSize>(['chip', 'filter'])('maps size="%s" to its modifier class', (size) => {
    render(<Pill size={size}>T</Pill>);
    expect(screen.getByText('T').classList.contains(`ui-pill--${size}`)).toBe(true);
  });

  it('renders a tone modifier only when tone is set', () => {
    const { rerender } = render(<Pill size="filter" tone="open">T</Pill>);
    const toned = screen.getByText('T');
    expect(classesOf(toned)).toEqual(expect.arrayContaining([
      'ui-pill',
      'ui-pill--filter',
      'ui-pill--open',
    ]));

    rerender(<Pill size="filter">T</Pill>);
    const plain = screen.getByText('T');
    expect(plain.classList.contains('ui-pill--filter')).toBe(true);
    expect(plain.classList.contains('ui-pill--open')).toBe(false);
  });

  it('colours each tone with its token utility', () => {
    render(
      <>
        <Pill tone="open">o</Pill>
        <Pill tone="in_progress">p</Pill>
        <Pill tone="done">d</Pill>
        <Pill tone="wont_do">w</Pill>
      </>,
    );
    expect(screen.getByText('o').classList.contains('bg-surface-sunken')).toBe(true);
    expect(screen.getByText('p').classList.contains('bg-warn-soft')).toBe(true);
    expect(screen.getByText('p').classList.contains('text-warn')).toBe(true);
    expect(screen.getByText('d').classList.contains('bg-ok-soft')).toBe(true);
    expect(screen.getByText('d').classList.contains('text-ok')).toBe(true);
    expect(screen.getByText('w').classList.contains('text-ink-3')).toBe(true);
  });

  /**
   * M8: `Open` and `Won't Do` shared one tint, so a dismissed item read as untouched and the
   * vocabulary's declared `--ink-3` for `wont_do` was dead on this surface.
   */
  it('gives wont_do its own ink tier, distinct from open', () => {
    render(
      <>
        <Pill tone="open">o</Pill>
        <Pill tone="wont_do">w</Pill>
      </>
    );
    const open = screen.getByText('o');
    const wontDo = screen.getByText('w');
    expect(wontDo.classList.contains('text-ink-3')).toBe(true);
    expect(wontDo.classList.contains('text-ink-2')).toBe(false);
    expect(open.classList.contains('text-ink-2')).toBe(true);
  });

  it('renders an anchor when as="a", preserving href', () => {
    render(
      <Pill as="a" href="/?tag=errand" size="filter">
        errand
      </Pill>,
    );
    const link = screen.getByRole('link', { name: 'errand' });
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/?tag=errand');
  });

  it('routes the as="a" branch through next/link (client-side navigation)', () => {
    render(
      <Pill as="a" href="/?tag=errand" size="filter">
        errand
      </Pill>,
    );
    const link = screen.getByRole('link', { name: 'errand' });
    // The jest moduleNameMapper resolves `next/link` to the stub, which stamps
    // `data-next-link`; a raw <a> would carry no such marker.
    expect(link.hasAttribute('data-next-link')).toBe(true);
  });


  it('drops the underline on the navigating branch only', () => {
    render(
      <Pill as="a" href="/?tag=errand" size="filter">
        errand
      </Pill>,
    );
    expect(screen.getByRole('link').classList.contains('no-underline')).toBe(true);

    render(<Pill>errand</Pill>);
    const chips = screen.getAllByText('errand');
    expect(chips[chips.length - 1].classList.contains('no-underline')).toBe(false);
  });

  it('adds the active modifier only when active', () => {
    const { rerender } = render(
      <Pill as="a" href="/x" size="filter">
        t
      </Pill>,
    );
    expect(screen.getByRole('link').classList.contains('ui-pill--active')).toBe(false);

    rerender(
      <Pill as="a" href="/x" size="filter" active>
        t
      </Pill>,
    );
    expect(screen.getByRole('link').classList.contains('ui-pill--active')).toBe(true);
  });

  it('merges className instead of replacing it', () => {
    render(<Pill className="legacy-hook">T</Pill>);
    const chip = classesOf(screen.getByText('T'));
    expect(chip).toEqual(
      expect.arrayContaining(['legacy-hook', 'ui-pill', 'ui-pill--chip']),
    );
  });

  it('renders no remove button when onRemove is absent', () => {
    render(<Pill>Tag</Pill>);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders the remove button with removeLabel verbatim as its aria-label', () => {
    render(
      <Pill onRemove={() => {}} removeLabel="Remove tag work">
        work
      </Pill>,
    );
    expect(screen.getByRole('button', { name: 'Remove tag work' })).toBeTruthy();
  });

  it('invokes onRemove when the remove button is clicked', () => {
    const onRemove = jest.fn();
    render(
      <Pill onRemove={onRemove} removeLabel="Remove tag work">
        work
      </Pill>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag work' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  /**
   * M6: a filter chip is an anchor in a `nav` and names the view itself, so the current one
   * says `aria-current="page"` — the APG meaning of the attribute, and the same signal
   * `tab-bar.tsx` sends. `active` stays the visual channel.
   */
  it('emits aria-current="page" on the navigating branch only when current', () => {
    const { rerender } = render(
      <Pill as="a" href="/?tag=errand" size="filter" current>
        errand
      </Pill>,
    );
    expect(screen.getByRole('link', { name: 'errand' }).getAttribute('aria-current')).toBe('page');

    rerender(
      <Pill as="a" href="/?tag=errand" size="filter">
        errand
      </Pill>,
    );
    expect(screen.getByRole('link', { name: 'errand' }).getAttribute('aria-current')).toBeNull();
  });

  it('leaves the visual active modifier independent of aria-current', () => {
    render(
      <Pill as="a" href="/x" size="filter" active>
        t
      </Pill>,
    );
    const link = screen.getByRole('link');
    expect(link.classList.contains('ui-pill--active')).toBe(true);
    expect(link.getAttribute('aria-current')).toBeNull();
  });

  /**
   * H1: the chip is 24px tall, so a 44px target cannot be the chip. The button's own box grows
   * to the touch minimum and the negative margins hand the growth back, leaving the chip's
   * height, its trailing edge and the 14px glyph where they were.
   */
  it('draws the remove control as a --tap target handed back by a negative margin', () => {
    render(
      <Pill onRemove={() => {}} removeLabel="Remove tag work">
        work
      </Pill>,
    );
    const remove = screen.getByRole('button', { name: 'Remove tag work' });
    expect(remove.classList.contains('min-h-[var(--tap)]')).toBe(true);
    expect(remove.classList.contains('p-[var(--s4)]')).toBe(true);
    expect(remove.classList.contains('-my-[calc((var(--tap)_-_var(--s6))/2)]')).toBe(true);
    expect(remove.classList.contains('-mx-[var(--s3)]')).toBe(true);
    // The floor remover M3/H1 named must be gone; `min-h-0` is what flattened the target.
    expect(remove.classList.contains('min-h-0')).toBe(false);
    // The glyph is untouched, which is what keeps the chip's own geometry intact.
    expect(remove.querySelector('svg')?.getAttribute('width')).toBe('14');
  });

  it('types the tag as span|a', () => {
    const tags: PillTag[] = ['span', 'a'];
    expect(tags).toHaveLength(2);
  });

  it('renders a no-href toggle as a real button, not an anchor with a patched role', () => {
    render(
      <Pill as="a" size="filter" onClick={() => {}}>
        t
      </Pill>,
    );
    const toggle = screen.getByRole('button', { name: 't' });
    expect(toggle.tagName).toBe('BUTTON');
    // Native focusability: no tabIndex or role attribute needed.
    expect(toggle.getAttribute('tabindex')).toBeNull();
    expect(toggle.getAttribute('role')).toBeNull();
  });

  it('keeps the no-href toggle inert when disabled', () => {
    const onClick = jest.fn();
    render(
      <Pill as="a" size="filter" disabled onClick={onClick}>
        t
      </Pill>,
    );
    fireEvent.click(screen.getByRole('button', { name: 't' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  /**
   * Regression: Tailwind v4's `outline-none` zeroes `--tw-outline-style`, so
   * `focus-visible:outline-2` alone computes `outline-style: none` and the ring never draws.
   * `focus-visible:outline-solid` must be present to re-arm it.
   */
  it('re-arms the outline style the reset zeroes, so the focused ring draws', () => {
    render(<Pill as="button">t</Pill>);
    const pill = screen.getByRole('button', { name: 't' });
    expect(pill.classList.contains('focus-visible:outline-solid')).toBe(true);
    expect(pill.classList.contains('focus-visible:outline-[length:var(--focus-ring)]')).toBe(true);
  });
});
