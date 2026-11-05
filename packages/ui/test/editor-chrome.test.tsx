import { fireEvent, render, screen } from '@testing-library/react';
import { EditorChrome } from '../src/components/editor-chrome';
import { AlertBanner } from '../src/components/alert-banner';
import { IconButton } from '../src/components/icon-button';
import { StatusText } from '../src/components/status-text';

const TAGS = [
  { id: 1, name: 'errand' },
  { id: 2, name: 'home' },
];

const back = { label: 'Back', onBack: () => {} };

/**
 * jsdom has no layout and no `ResizeObserver`; `cmdk`'s list measures itself on mount, and the
 * popover test below opens that list.
 */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  (Element.prototype as unknown as { scrollIntoView: jest.Mock }).scrollIntoView = jest.fn();
});

describe('EditorChrome', () => {
  it('renders the toolbar slots: back label, title as a real h1, actions', () => {
    render(
      <EditorChrome back={back} title="Edit" actions={<IconButton label="Save" />}>
        <input aria-label="Body" />
      </EditorChrome>,
    );
    expect(screen.getByRole('button', { name: 'Back' }).tagName).toBe('BUTTON');
    expect(screen.getByRole('heading', { level: 1, name: 'Edit' }).className).toContain(
      'ui-editor-toolbar__title',
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('renders the status slot when no title is given', () => {
    render(
      <EditorChrome back={back} status={<StatusText>Saving…</StatusText>}>
        <input aria-label="Body" />
      </EditorChrome>,
    );
    expect(screen.getByRole('status').textContent).toBe('Saving…');
  });

  it('lets title win over status', () => {
    render(
      <EditorChrome back={back} title="New" status={<StatusText>Saved</StatusText>}>
        <input aria-label="Body" />
      </EditorChrome>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'New' })).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders the banner between the toolbar and the body stack', () => {
    const { container } = render(
      <EditorChrome
        back={back}
        banner={<AlertBanner role="alert">Changed elsewhere.</AlertBanner>}
      >
        <input aria-label="Body" />
      </EditorChrome>,
    );
    const children = Array.from(container.querySelector('.ui-editor-screen')!.children);
    expect(children).toHaveLength(3);
    expect(children[0]).toBe(container.querySelector('.ui-editor-toolbar'));
    expect(children[1]).toBe(container.querySelector('.ui-alert-banner'));
    expect(children[2]).toBe(container.querySelector('.ui-editor-stack'));
  });

  it('stacks the children inside EditorStack (default gap lg)', () => {
    const { container } = render(
      <EditorChrome back={back}>
        <input aria-label="Body" />
      </EditorChrome>,
    );
    const stack = container.querySelector('.ui-editor-stack')!;
    expect(stack.classList.contains('ui-editor-stack--lg')).toBe(true);
    expect(stack.contains(screen.getByLabelText('Body'))).toBe(true);
  });

  it('honours a gap override', () => {
    const { container } = render(
      <EditorChrome back={back} gap="sm">
        <input aria-label="Body" />
      </EditorChrome>,
    );
    const stack = container.querySelector('.ui-editor-stack')!;
    expect(stack.classList.contains('ui-editor-stack--sm')).toBe(true);
    expect(stack.classList.contains('ui-editor-stack--lg')).toBe(false);
  });

  it('renders the tag combobox inside the stack when provided and passes onToggle through', () => {
    const onToggle = jest.fn();
    const { container } = render(
      <EditorChrome
        back={back}
        tagPicker={{ tags: TAGS, selectedIds: [1], onToggle, label: 'Attached tags' }}
      >
        <input aria-label="Body" />
      </EditorChrome>,
    );
    // The caption names the field, so the trigger's name survives whatever chips it holds.
    const trigger = screen.getByRole('button', { name: 'Attached tags' });
    const control = container.querySelector('.ui-tag-combobox')!;
    expect(control.contains(trigger)).toBe(true);
    expect(container.querySelector('.ui-editor-stack')!.contains(control)).toBe(true);
    expect(container.querySelector('.ui-tag-combobox__chips')!.textContent).toContain('errand');

    fireEvent.click(trigger);
    const rows = screen.getAllByRole('option');
    expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    fireEvent.click(rows[1]);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(2);
  });

  it('renders no tag combobox when tagPicker is omitted', () => {
    const { container } = render(
      <EditorChrome back={back}>
        <input aria-label="Body" />
      </EditorChrome>,
    );
    expect(container.querySelector('.ui-tag-combobox')).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('renders the back control as a button, never a link', () => {
    const onBack = jest.fn();
    render(
      <EditorChrome back={{ label: 'Back', onBack }}>
        <input aria-label="Body" />
      </EditorChrome>,
    );
    const control = screen.getByRole('button', { name: 'Back' });
    expect(control.tagName).toBe('BUTTON');
    expect(control.getAttribute('aria-label')).toBe('Back');
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(control);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
