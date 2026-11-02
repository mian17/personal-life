import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { EditorScreen } from '../src/components/editor-screen';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('EditorScreen', () => {
  it('renders a <div> with the ui-editor-screen class', () => {
    render(<EditorScreen>content</EditorScreen>);
    const screenEl = screen.getByText('content');
    expect(screenEl.tagName).toBe('DIV');
    expect(classesOf(screenEl)).toEqual(expect.arrayContaining(['ui-editor-screen']));
  });

  // jsdom never applies stylesheets, so the page-height layout is read off the classes it carries.
  it('takes its height and safe-area padding from utilities rather than a stylesheet rule', () => {
    render(<EditorScreen>content</EditorScreen>);
    const screenEl = screen.getByText('content');
    expect(screenEl.classList.contains('flex')).toBe(true);
    expect(screenEl.classList.contains('flex-col')).toBe(true);
    expect(screenEl.classList.contains('min-h-[100dvh]')).toBe(true);
    expect(
      screenEl.classList.contains('pt-[max(var(--s3),env(safe-area-inset-top))]'),
    ).toBe(true);
    expect(
      screenEl.classList.contains('pb-[calc(var(--s4)+env(safe-area-inset-bottom))]'),
    ).toBe(true);
    expect(screenEl.classList.contains('px-[var(--s4)]')).toBe(true);
  });

  it('renders its children inside the container', () => {
    render(
      <EditorScreen>
        <span data-testid="inner">nested</span>
      </EditorScreen>,
    );
    expect(screen.getByText('nested').contains(screen.getByTestId('inner'))).toBe(true);
  });

  it('merges className instead of replacing it', () => {
    render(<EditorScreen className="legacy-hook">content</EditorScreen>);
    expect(classesOf(screen.getByText('content'))).toEqual(
      expect.arrayContaining(['legacy-hook', 'ui-editor-screen']),
    );
  });

  it('forwards arbitrary attributes and a ref', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <EditorScreen ref={ref} data-extra="1">
        content
      </EditorScreen>,
    );
    const el = screen.getByText('content');
    expect(el.getAttribute('data-extra')).toBe('1');
    expect(ref.current).toBe(el);
  });
});
