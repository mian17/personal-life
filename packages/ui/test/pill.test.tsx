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
    expect(classesOf(chip)).toEqual(['ui-pill', 'ui-pill--chip']);
  });

  it.each<PillSize>(['chip', 'filter'])('maps size="%s" to its modifier class', (size) => {
    render(<Pill size={size}>T</Pill>);
    expect(screen.getByText('T').classList.contains(`ui-pill--${size}`)).toBe(true);
  });

  it('renders a tone modifier only when tone is set', () => {
    const { rerender } = render(<Pill size="filter" tone="open">T</Pill>);
    expect(classesOf(screen.getByText('T'))).toEqual([
      'ui-pill',
      'ui-pill--filter',
      'ui-pill--open',
    ]);

    rerender(<Pill size="filter">T</Pill>);
    expect(classesOf(screen.getByText('T'))).toEqual(['ui-pill', 'ui-pill--filter']);
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
    expect(classesOf(screen.getByText('T'))).toEqual([
      'legacy-hook',
      'ui-pill',
      'ui-pill--chip',
    ]);
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

  it('types the tag as span|a', () => {
    const tags: PillTag[] = ['span', 'a'];
    expect(tags).toHaveLength(2);
  });
});
