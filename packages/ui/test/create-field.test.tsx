import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { CreateField } from '../src/components/create-field';

function renderField(props: Partial<ComponentProps<typeof CreateField>> = {}) {
  const onCreate = jest.fn();
  const view = render(
    <CreateField
      className="ui-probe__create"
      placeholder="New tag"
      createLabel="Add tag"
      onCreate={onCreate}
      {...props}
    />,
  );
  const input = screen.getByLabelText('New tag') as HTMLInputElement;
  const submit = screen.getByRole('button', { name: 'Add tag' }) as HTMLButtonElement;
  return { onCreate, input, submit, ...view };
}

describe('CreateField', () => {
  it('associates the accessible name with the text input', () => {
    const { input, container } = renderField();
    expect(input.tagName).toBe('INPUT');
    expect(input.getAttribute('placeholder')).toBe('New tag');
    expect(screen.getByRole('textbox', { name: 'New tag' })).toBe(input);
    expect(container.querySelector('.ui-probe__create')?.contains(input)).toBe(true);
  });

  it('submits the trimmed draft and clears it', () => {
    const { onCreate, input, submit } = renderField();
    fireEvent.change(input, { target: { value: '  errand  ' } });
    fireEvent.click(submit);
    expect(onCreate).toHaveBeenCalledWith('errand');
    expect(input.value).toBe('');
  });

  it('submits on Enter without submitting the surrounding form', () => {
    const { onCreate, input } = renderField();
    fireEvent.change(input, { target: { value: 'home' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCreate).toHaveBeenCalledWith('home');
  });

  it('disables submit until the draft holds a non-blank name', () => {
    const { input, submit } = renderField();
    expect(submit.disabled).toBe(true);
    fireEvent.change(input, { target: { value: '   ' } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'home' } });
    expect(submit.disabled).toBe(false);
  });

  it('keeps both controls disabled when the field is disabled', () => {
    const { input, submit } = renderField({ disabled: true });
    fireEvent.change(input, { target: { value: 'home' } });
    expect(input.disabled).toBe(true);
    expect(submit.disabled).toBe(true);
  });
});
