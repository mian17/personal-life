import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Dialog } from '../src/components/dialog';

/**
 * A controlled surface with a real opener, so closing can be observed from the opener's side:
 * Radix returns focus to whatever held it when the panel opened.
 */
function Opener({ size }: Readonly<{ size?: 'default' | 'full' | 'sheet' }>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open repeat
      </button>
      <Dialog open={open} onOpenChange={setOpen} title="Custom repeat" size={size}>
        <input aria-label="Days" />
      </Dialog>
    </>
  );
}

function setup(props: Partial<Parameters<typeof Dialog>[0]> = {}) {
  const onOpenChange = jest.fn();
  render(
    <Dialog open={false} onOpenChange={onOpenChange} title="Custom repeat" {...props}>
      <input aria-label="Days" />
    </Dialog>,
  );
  return { onOpenChange };
}

const dialog = () => screen.getByRole('dialog');
const overlay = () => document.querySelector('[data-slot="dialog-overlay"]')!;

describe('Dialog', () => {
  it('mounts no modal surface while closed', () => {
    setup();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens as a dialog named by its visible title', () => {
    setup({ open: true });
    const title = screen.getByRole('heading', { level: 2, name: 'Custom repeat' });
    expect(dialog().getAttribute('aria-labelledby')).toBe(title.getAttribute('id'));
  });

  it('renders the description under the title inside the header', () => {
    setup({ open: true, description: 'One thing.' });
    const sub = screen.getByText('One thing.');
    expect(sub.tagName).toBe('P');
    expect(sub.classList.contains('ui-dialog__sub')).toBe(true);
    expect(sub.closest('.ui-dialog__head')).not.toBeNull();
    expect(sub.closest('.ui-dialog__title-block')).not.toBeNull();
  });

  it('renders no description line when none is given', () => {
    setup({ open: true });
    expect(document.querySelector('.ui-dialog__sub')).toBeNull();
  });

  it('fires onOpenChange(false) from the Close icon button', () => {
    const { onOpenChange } = setup({ open: true });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('fires onOpenChange(false) on Escape', () => {
    const { onOpenChange } = setup({ open: true });
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('fires onOpenChange(false) on a backdrop press', async () => {
    const { onOpenChange } = setup({ open: true });
    // Radix attaches its outside-pointer listener a tick after mount, so the press waits for it.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    fireEvent.pointerDown(overlay());
    fireEvent.click(overlay());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not close a press inside the panel', async () => {
    const { onOpenChange } = setup({ open: true });
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    const field = screen.getByLabelText('Days');
    fireEvent.pointerDown(field);
    fireEvent.click(field);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('returns focus to the opener once closed', () => {
    render(<Opener />);
    const opener = screen.getByRole('button', { name: 'Open repeat' });
    // `fireEvent` dispatches without the browser's focus step, so the opener is focused by hand —
    // which is exactly the pre-open focus the panel must hand back.
    opener.focus();
    fireEvent.click(opener);
    expect(dialog()).toBeTruthy();

    fireEvent.keyDown(dialog(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('renders the footer when provided', () => {
    setup({ open: true, footer: <span data-testid="footer" /> });
    expect(screen.getByTestId('footer')).toBeTruthy();
    expect(document.querySelector('.ui-dialog__footer')).not.toBeNull();
  });

  it('leaves the full-screen sheet class off the default size', () => {
    setup({ open: true });
    expect(dialog().classList.contains('ui-dialog--full')).toBe(false);
  });

  it('emits ui-dialog--full for size="full" — the full-screen sheet', () => {
    setup({ open: true, size: 'full' });
    const panel = dialog();
    expect(panel.classList.contains('ui-dialog')).toBe(true);
    expect(panel.classList.contains('ui-dialog--full')).toBe(true);
  });

  it('emits ui-dialog--sheet and a grab handle for size="sheet" — the bottom sheet', () => {
    setup({ open: true, size: 'sheet' });
    const panel = dialog();
    expect(panel.classList.contains('ui-dialog--sheet')).toBe(true);
    expect(panel.classList.contains('ui-dialog--full')).toBe(false);
    expect(document.querySelector('.ui-dialog__grab')).not.toBeNull();
  });

  it('leaves the sheet grab handle off the centred panel', () => {
    setup({ open: true });
    expect(document.querySelector('.ui-dialog__grab')).toBeNull();
  });

  /**
   * The sheet's entrance is a transition from a `@starting-style` value. jsdom computes no
   * transitions, so the runnable check is the class list the stylesheet compiles: the starting
   * style must repeat `[data-state=open]` or it loses to the open state's own reset on specificity
   * and the panel is already at its final position on the first frame. The visual proof is the
   * playwright probe in the task report.
   */
  it('starts the sheet off screen at a specificity that outranks its open state', () => {
    setup({ open: true, size: 'sheet' });
    const classes = dialog().classList;

    expect(classes.contains('starting:data-[state=open]:translate-y-full')).toBe(true);
    expect(classes.contains('starting:translate-y-full')).toBe(false);
    expect(classes.contains('data-[state=open]:translate-y-0')).toBe(true);
    expect(classes.contains('motion-safe:transition-transform')).toBe(true);
  });

  /**
   * The sheet's exit is a keyframe in `base.css` keyed on `[data-state="closed"]`, because
   * Radix's Presence waits for `animationend` and never for `transitionend`. jsdom applies no
   * stylesheet, so the runnable check is the class that opts the shared overlay into that rule;
   * the playwright probe in the task report is the visual proof of the travel itself.
   */
  it('carries the scrim exit hook on the sheet overlay only', () => {
    setup({ open: true, size: 'sheet' });
    expect(overlay().classList.contains('ui-dialog__scrim--sheet')).toBe(true);

    cleanup();
    setup({ open: true });
    expect(overlay().classList.contains('ui-dialog__scrim--sheet')).toBe(false);

    cleanup();
    setup({ open: true, size: 'full' });
    expect(overlay().classList.contains('ui-dialog__scrim--sheet')).toBe(false);
  });
});
