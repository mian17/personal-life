import { fireEvent, render, screen } from '@testing-library/react';
import { EditorToolbar } from '../src/components/editor-toolbar';
import { StatusText } from '../src/components/status-text';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('EditorToolbar', () => {
  it('renders the title as a real h1 (heading) when given', () => {
    render(<EditorToolbar back={{ label: 'Back', onBack: () => {} }} title="New Todo" />);
    const heading = screen.getByRole('heading', { level: 1, name: 'New Todo' });
    expect(heading.className).toContain('ui-editor-toolbar__title');
  });

  it('renders no heading when no title is given', () => {
    render(<EditorToolbar back={{ label: 'Back', onBack: () => {} }} />);
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('renders a container with the ui-editor-toolbar class', () => {
    render(<EditorToolbar back={{ label: 'Back', onBack: () => {} }} />);
    const toolbar = document.querySelector('.ui-editor-toolbar')!;
    expect(toolbar.tagName).toBe('DIV');
    expect(classesOf(toolbar)).toEqual(expect.arrayContaining(['ui-editor-toolbar']));
  });

  // jsdom never applies stylesheets, so the row layout is read off the classes it carries.
  it('takes its row geometry from utilities rather than a stylesheet rule', () => {
    render(<EditorToolbar back={{ label: 'Back', onBack: () => {} }} />);
    const toolbar = document.querySelector('.ui-editor-toolbar')!;
    expect(toolbar.classList.contains('flex')).toBe(true);
    expect(toolbar.classList.contains('items-center')).toBe(true);
    expect(toolbar.classList.contains('justify-between')).toBe(true);
    expect(toolbar.classList.contains('mb-[var(--s2)]')).toBe(true);

    const title = render(
      <EditorToolbar back={{ label: 'Back', onBack: () => {} }} title="New" />,
    );
    const heading = title.container.querySelector('h1')!;
    expect(heading.classList.contains('flex-1')).toBe(true);
    expect(heading.classList.contains('text-center')).toBe(true);
    expect(heading.classList.contains('font-semibold')).toBe(true);
  });

  it('renders the back control as a button (never a link) carrying the label verbatim', () => {
    render(<EditorToolbar back={{ label: 'Go back', onBack: () => {} }} />);
    const back = screen.getByRole('button', { name: 'Go back' });
    expect(back.tagName).toBe('BUTTON');
    expect(back.getAttribute('aria-label')).toBe('Go back');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('invokes onBack when the back button is clicked', () => {
    const onBack = jest.fn();
    render(<EditorToolbar back={{ label: 'Back', onBack }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders the status slot between the back control and the actions slot', () => {
    render(
      <EditorToolbar
        back={{ label: 'Back', onBack: () => {} }}
        status={<StatusText>Saving…</StatusText>}
        actions={<button type="button">Save</button>}
      />,
    );
    const toolbar = document.querySelector('.ui-editor-toolbar')!;
    const children = Array.from(toolbar.children);
    expect(children[0]).toBe(screen.getByRole('button', { name: 'Back' }));
    expect(children[1]).toBe(screen.getByRole('status'));
    expect(children[2]).toBe(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('status').textContent).toBe('Saving…');
  });

  it('omits the status and actions slots when not provided', () => {
    render(<EditorToolbar back={{ label: 'Back', onBack: () => {} }} />);
    const toolbar = document.querySelector('.ui-editor-toolbar')!;
    expect(toolbar.children).toHaveLength(1);
  });

  it('renders the sub-line beneath the title on §6 `.row__meta` tokens', () => {
    render(
      <EditorToolbar
        back={{ label: 'Back', onBack: () => {} }}
        title="Lunch"
        sub="Thursday, 30 October · 12:40"
      />,
    );
    const heading = screen.getByRole('heading', { level: 1, name: 'Lunch' });
    const middle = document.querySelector('.ui-editor-toolbar__main')!;
    const sub = document.querySelector('.ui-editor-toolbar__sub')!;

    expect(middle.contains(heading)).toBe(true);
    expect(Array.from(middle.children)).toEqual([heading, sub]);
    expect(sub.textContent).toBe('Thursday, 30 October · 12:40');
    expect(classesOf(sub)).toEqual(
      expect.arrayContaining([
        'text-[length:var(--fs-meta)]',
        'leading-[var(--lh-meta)]',
        'text-ink-2',
        'mt-[var(--s2)]',
      ]),
    );
  });

  it('renders no sub-line and no wrapper when sub is absent', () => {
    render(<EditorToolbar back={{ label: 'Back', onBack: () => {} }} title="New" />);
    expect(document.querySelector('.ui-editor-toolbar__sub')).toBeNull();
    expect(document.querySelector('.ui-editor-toolbar__main')).toBeNull();
    const toolbar = document.querySelector('.ui-editor-toolbar')!;
    expect(toolbar.children).toHaveLength(2);
    expect(toolbar.children[1]).toBe(screen.getByRole('heading', { level: 1 }));
  });

  it('keeps the sub-line ordering with status and actions present', () => {
    render(
      <EditorToolbar
        back={{ label: 'Back', onBack: () => {} }}
        title="Lunch"
        sub="12:40"
        actions={<button type="button">Save</button>}
      />,
    );
    const toolbar = document.querySelector('.ui-editor-toolbar')!;
    expect(Array.from(toolbar.children)).toEqual([
      screen.getByRole('button', { name: 'Back' }),
      document.querySelector('.ui-editor-toolbar__main'),
      screen.getByRole('button', { name: 'Save' }),
    ]);
    expect(document.querySelector('.ui-editor-toolbar__sub')!.textContent).toBe('12:40');
  });

  it('merges className instead of replacing it', () => {
    render(<EditorToolbar className="legacy-hook" back={{ label: 'Back', onBack: () => {} }} />);
    expect(classesOf(document.querySelector('.ui-editor-toolbar')!)).toEqual(
      expect.arrayContaining(['legacy-hook', 'ui-editor-toolbar']),
    );
  });
});
