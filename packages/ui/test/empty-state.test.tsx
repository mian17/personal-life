import { render, screen } from '@testing-library/react';
import { EmptyState } from '../src/components/empty-state';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('EmptyState', () => {
  it('renders a ui-empty div with heading and body copy passed in verbatim', () => {
    render(<EmptyState heading="No notes yet." body="Tap + to write your first note." />);
    const root = document.querySelector('.ui-empty')!;
    expect(root.tagName).toBe('DIV');
    expect(root.classList.contains('ui-empty')).toBe(true);
    expect(screen.getByText('No notes yet.')).toBeTruthy();
    expect(screen.getByText('Tap + to write your first note.')).toBeTruthy();
  });

  it('composes the card box but keeps it unfilled and quiet', () => {
    render(<EmptyState body="Trash is empty." />);
    const root = document.querySelector('.ui-empty')!;
    expect(root.classList.contains('ui-card')).toBe(true);
    expect(root.getAttribute('data-slot')).toBe('card');
    // A panel surface would read as a filled box behind centred copy, so the
    // layout cancels both the panel fill and its border.
    expect(root.classList.contains('bg-transparent')).toBe(true);
    expect(root.classList.contains('border-0')).toBe(true);
    expect(root.classList.contains('text-center')).toBe(true);
    // The quiet colour rides the copy, not the box: Card already sets a text
    // colour on the box and a second one there would race it.
    expect(document.querySelector('.ui-empty p')!.classList.contains('text-muted')).toBe(true);
  });

  it('renders both copies as paragraphs inside the block', () => {
    render(<EmptyState heading="Nothing here." body="Come back later." />);
    const paragraphs = document.querySelectorAll('.ui-empty p');
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].textContent).toBe('Nothing here.');
    expect(paragraphs[1].textContent).toBe('Come back later.');
  });

  it('omits the heading paragraph when heading is not provided', () => {
    render(<EmptyState body="Trash is empty." />);
    const root = document.querySelector('.ui-empty')!;
    expect(root.children).toHaveLength(1);
    expect(root.textContent).toBe('Trash is empty.');
  });

  it('never bakes copy: accepts arbitrary nodes', () => {
    render(<EmptyState heading={<strong>Custom</strong>} body={<em>body</em>} />);
    expect(screen.getByText('Custom').tagName).toBe('STRONG');
    expect(screen.getByText('body').tagName).toBe('EM');
  });

  it('merges className instead of replacing it', () => {
    render(<EmptyState className="legacy-hook" body="empty" />);
    expect(classesOf(document.querySelector('.ui-empty')!)).toEqual(
      expect.arrayContaining(['legacy-hook', 'ui-empty']),
    );
  });

  it('forwards arbitrary attributes', () => {
    render(<EmptyState data-extra="1" aria-label="empty state" body="empty" />);
    const root = document.querySelector('.ui-empty')!;
    expect(root.getAttribute('data-extra')).toBe('1');
    expect(root.getAttribute('aria-label')).toBe('empty state');
  });
});
