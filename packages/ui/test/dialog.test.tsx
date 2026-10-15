import { fireEvent, render, screen } from '@testing-library/react';
import { Dialog } from '../src/components/dialog';

// jsdom 20 defines HTMLDialogElement but not its modal methods; the spec owns
// the shim and asserts against it (the component never feature-detects them).
type DialogShim = {
  showModal: jest.Mock;
  close: jest.Mock;
};

describe('Dialog', () => {
  const showModal = jest.fn();
  const close = jest.fn();

  beforeEach(() => {
    showModal.mockClear();
    close.mockClear();
    (HTMLDialogElement.prototype as unknown as DialogShim).showModal = showModal;
    (HTMLDialogElement.prototype as unknown as DialogShim).close = close;
  });

  function setup(props: Partial<Parameters<typeof Dialog>[0]> = {}) {
    const onOpenChange = jest.fn();
    render(
      <Dialog open={false} onOpenChange={onOpenChange} title="Custom repeat" {...props}>
        <span data-testid="body" />
      </Dialog>,
    );
    return { onOpenChange };
  }

  it('does not call showModal when closed', () => {
    setup();
    expect(showModal).not.toHaveBeenCalled();
  });

  it('calls showModal when open', () => {
    setup({ open: true });
    expect(showModal).toHaveBeenCalledTimes(1);
  });

  it('fires onOpenChange(false) from the Close icon button', () => {
    const { onOpenChange } = setup({ open: true });
    fireEvent.click(screen.getByRole('button', { name: 'Close', hidden: true }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('fires onOpenChange(false) when the element emits close', () => {
    const { onOpenChange } = setup({ open: true });
    fireEvent(document.querySelector('dialog')!, new Event('close'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('names the dialog with its visible title', () => {
    setup({ open: true });
    const dialog = document.querySelector('dialog')!;
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    const title = document.getElementById(labelledBy!)!;
    expect(title).toBe(document.querySelector('.ui-dialog__title'));
    expect(title.textContent).toBe('Custom repeat');
  });

  it('fires onOpenChange(false) on a backdrop click outside the dialog box', () => {
    const { onOpenChange } = setup({ open: true });
    // jsdom's getBoundingClientRect() is all zeros; anything non-zero is "outside".
    fireEvent.click(document.querySelector('dialog')!, { clientX: 500, clientY: 500 });
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not close on a click inside the dialog box', () => {
    const { onOpenChange } = setup({ open: true });
    fireEvent.click(document.querySelector('dialog')!, { clientX: 0, clientY: 0 });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('does not close when a child control click bubbles up (keyboard activation)', () => {
    const onOpenChange = jest.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} title="Custom repeat">
        <button type="button">Mon</button>
      </Dialog>,
    );
    const dialog = document.querySelector('dialog')!;
    // jsdom's default all-zero rect would read 0,0 as "inside"; a real centered
    // box is non-zero, so emulate it to expose the rect-only bug.
    jest.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      right: 500,
      top: 100,
      bottom: 400,
      x: 100,
      y: 100,
      width: 400,
      height: 300,
      toJSON: () => ({}),
    } as DOMRect);
    // Keyboard Enter/Space on a child dispatches with target = the child and
    // clientX/clientY 0, which a rect-only check reads as "outside" in jsdom.
    fireEvent.click(screen.getByRole('button', { name: 'Mon', hidden: true }));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('renders the footer when provided', () => {
    setup({ footer: <span data-testid="footer" /> });
    expect(screen.getByTestId('footer')).toBeTruthy();
    expect(document.querySelector('.ui-dialog__footer')).not.toBeNull();
  });

  it('leaves the full-screen sheet class off the default size', () => {
    setup();
    expect(document.querySelector('.ui-dialog--full')).toBeNull();
  });

  it('emits ui-dialog--full for size="full" — the full-screen sheet', () => {
    setup({ open: true, size: 'full' });
    const dialog = document.querySelector('.ui-dialog')!;
    expect(dialog.classList.contains('ui-dialog--full')).toBe(true);
    // It is still a native modal dialog, not a div wrapper.
    expect(dialog.tagName).toBe('DIALOG');
  });
});
