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
    expect(classesOf(screenEl)).toEqual(['ui-editor-screen']);
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
    expect(classesOf(screen.getByText('content'))).toEqual(['legacy-hook', 'ui-editor-screen']);
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
