import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Textarea, type TextareaVariant } from '../src/components/textarea';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('Textarea', () => {
  it('renders a <textarea> carrying only the base class for the default variant', () => {
    render(<Textarea aria-label="Note body" />);
    const textarea = screen.getByLabelText('Note body');
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(classesOf(textarea)).toEqual(['ui-textarea']);
  });

  it('adds the editor modifier for variant="editor"', () => {
    render(<Textarea aria-label="Note body" variant="editor" />);
    expect(classesOf(screen.getByLabelText('Note body'))).toEqual([
      'ui-textarea',
      'ui-textarea--editor',
    ]);
  });

  it.each<TextareaVariant>(['default', 'editor'])(
    'accepts variant="%s"',
    (variant) => {
      render(<Textarea aria-label={`v-${variant}`} variant={variant} />);
      expect(screen.getByLabelText(`v-${variant}`).tagName).toBe('TEXTAREA');
    },
  );

  it('forwards form attributes verbatim', () => {
    render(
      <Textarea
        aria-label="Note body"
        name="body"
        placeholder="Write a note… use #tags inline"
        rows={5}
        defaultValue="draft"
      />,
    );
    const textarea = screen.getByLabelText('Note body') as HTMLTextAreaElement;
    expect(textarea.getAttribute('name')).toBe('body');
    expect(textarea.getAttribute('placeholder')).toBe('Write a note… use #tags inline');
    expect(textarea.getAttribute('rows')).toBe('5');
    expect(textarea.value).toBe('draft');
  });

  it('forwards onChange', () => {
    const onChange = jest.fn();
    render(<Textarea aria-label="body" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('body'), { target: { value: 'typed' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('merges className instead of replacing it', () => {
    render(<Textarea aria-label="body" variant="editor" className="legacy-hook" />);
    expect(classesOf(screen.getByLabelText('body'))).toEqual([
      'legacy-hook',
      'ui-textarea',
      'ui-textarea--editor',
    ]);
  });

  it('forwards a ref to the rendered element', () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<Textarea aria-label="body" ref={ref} />);
    expect(ref.current).toBe(screen.getByLabelText('body'));
  });
});
