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
    expect(classesOf(toolbar)).toEqual(['ui-editor-toolbar']);
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

  it('merges className instead of replacing it', () => {
    render(<EditorToolbar className="legacy-hook" back={{ label: 'Back', onBack: () => {} }} />);
    expect(classesOf(document.querySelector('.ui-editor-toolbar')!)).toEqual([
      'legacy-hook',
      'ui-editor-toolbar',
    ]);
  });
});
