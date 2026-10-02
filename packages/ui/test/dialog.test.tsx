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

  it('renders the footer when provided', () => {
    setup({ footer: <span data-testid="footer" /> });
    expect(screen.getByTestId('footer')).toBeTruthy();
    expect(document.querySelector('.ui-dialog__footer')).not.toBeNull();
  });
});
