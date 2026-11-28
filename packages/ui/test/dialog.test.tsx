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
const classesOf = (el: Element) => el.className.split(/\s+/).filter(Boolean);

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

  /**
   * The design's confirm is one column at `--s4`: the copy sits a full step under the title, not
   * the hairline's own `--s1`. The step is stated on the line, so the title keeps `m-0` alone.
   */
  it('spaces the description a full --s4 under the title', () => {
    setup({ open: true, description: 'One thing.' });
    const classes = classesOf(screen.getByText('One thing.'));
    expect(classes).toContain('mt-[var(--s4)]');
    expect(classes).not.toContain('mt-[var(--s1)]');
    expect(classes).toContain('m-0');
  });

  it("selects the sheet title's 600 weight rather than stacking it on the bold one", () => {
    setup({ open: true });
    const classes = classesOf(screen.getByRole('heading', { level: 2, name: 'Custom repeat' }));
    expect(classes).toContain('[font-weight:var(--fw-semibold)]');
    expect(classes).not.toContain('font-bold');
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

describe('Dialog — header slots, dismiss and body rhythm', () => {
  it('draws the close control by default', () => {
    setup({ open: true });
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('replaces the drawn close control with a trailing action', () => {
    setup({ open: true, trailingAction: <button type="button">Save</button> });
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('keeps the title and its copy in the confirm shape, and removes the grab and the close', () => {
    setup({
      open: true,
      size: 'sheet',
      dismiss: false,
      description: 'The minutes you have sat are not saved.',
    });

    expect(screen.getByRole('heading', { level: 2, name: 'Custom repeat' })).toBeTruthy();
    expect(screen.getByText('The minutes you have sat are not saved.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(document.querySelector('.ui-dialog__grab')).toBeNull();
  });

  it('lets dismiss={false} outrank a trailing action, because there is no row to sit in', () => {
    setup({
      open: true,
      size: 'sheet',
      dismiss: false,
      trailingAction: <button type="button">Save</button>,
    });

    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('switches the header to the three-column line when an action is present', () => {
    setup({ open: true, leadingAction: <button type="button">Cancel</button> });
    const header = document.querySelector('.ui-dialog__head')!;

    expect(header.classList.contains('grid')).toBe(true);
    expect(header.classList.contains('grid-cols-[1fr_auto_1fr]')).toBe(true);
    expect(document.querySelector('.ui-dialog__leading')!.textContent).toBe('Cancel');
  });

  it('leaves the two-part header alone when no action is given', () => {
    setup({ open: true });
    const header = document.querySelector('.ui-dialog__head')!;

    expect(header.classList.contains('grid')).toBe(false);
    expect(header.classList.contains('justify-between')).toBe(true);
    expect(document.querySelector('.ui-dialog__leading')).toBeNull();
  });

  it('spaces the body one step wider on request, and at --s4 by default', () => {
    setup({ open: true, bodyGap: 's5' });
    let body = document.querySelector('.ui-dialog__body')!;
    expect(body.classList.contains('gap-[var(--s5)]')).toBe(true);
    expect(body.classList.contains('gap-[var(--s4)]')).toBe(false);
    cleanup();

    setup({ open: true });
    body = document.querySelector('.ui-dialog__body')!;
    expect(body.classList.contains('gap-[var(--s4)]')).toBe(true);
    expect(body.classList.contains('gap-[var(--s5)]')).toBe(false);
  });

  /**
   * The geometry move: the sheet's padding leaves the panel and lands on the slots, so a slot's
   * rule — the header hairline — can reach the panel's edges.
   */
  it('moves the sheet padding from the panel to its slots', () => {
    setup({ open: true, size: 'sheet' });
    const panel = dialog();
    const body = document.querySelector('.ui-dialog__body')!;

    expect(panel.classList.contains('px-0')).toBe(true);
    expect(
      panel.classList.contains(
        'p-[var(--s2)_var(--s4)_calc(var(--s6)+env(safe-area-inset-bottom))]',
      ),
    ).toBe(false);
    expect(body.classList.contains('px-[var(--s4)]')).toBe(true);
    expect(body.classList.contains('pb-[var(--s8)]')).toBe(true);
    expect(document.querySelector('.ui-dialog__head')!.classList.contains('border-b')).toBe(true);
  });

  it('keeps the confirm inset on the panel, which has no header row to inset', () => {
    setup({ open: true, size: 'sheet', dismiss: false });
    const panel = dialog();

    expect(panel.classList.contains('pt-[var(--s6)]')).toBe(true);
    expect(panel.classList.contains('px-[var(--s5)]')).toBe(true);
  });

  /**
   * The confirm draws its own panel inset, so its body must not draw a second one: the actions
   * would otherwise sit `--s4` inside the `--s5` the panel already applies.
   */
  it('insets the confirm body once, from the panel alone', () => {
    setup({ open: true, size: 'sheet', dismiss: false });
    const body = document.querySelector('.ui-dialog__body')!;

    expect(body.classList.contains('px-[var(--s4)]')).toBe(false);
    expect(body.classList.contains('pb-[var(--s8)]')).toBe(false);
  });

  /**
   * The grab is a decoration on the panel's top edge, not a row: the design draws the header at the
   * panel's edge, so a grab that took flow height would push every field a step down.
   */
  it('draws the grab over the panel edge instead of above the header', () => {
    setup({ open: true, size: 'sheet' });
    const classes = classesOf(document.querySelector('.ui-dialog__grab')!);

    expect(classes).toContain('absolute');
    expect(classes).toContain('top-0');
    expect(classes.some((utility) => utility.startsWith('mt-'))).toBe(false);
  });

  /**
   * A sheet's padding lives on its slots, so its header opens on the panel's edge; the centred and
   * full panels keep their own `--s2` inset, which is what every shipped dialog renders.
   */
  it('opens the sheet header on the panel edge and keeps the inset on the centred panel', () => {
    setup({ open: true, size: 'sheet' });
    let header = classesOf(document.querySelector('.ui-dialog__head')!);
    expect(header).not.toContain('mt-[var(--s2)]');
    cleanup();

    setup({ open: true });
    header = classesOf(document.querySelector('.ui-dialog__head')!);
    expect(header).toContain('mt-[var(--s2)]');
  });
});

describe('Dialog — the optional grab handle and title alignment', () => {
  /**
   * The handle is the shipped default for every sheet: the design's meditation sheet is the one
   * surface that draws none, and it says so with the prop rather than by changing the primitive.
   */
  it('draws the sheet grab handle by default', () => {
    setup({ open: true, size: 'sheet' });
    expect(document.querySelector('.ui-dialog__grab')).not.toBeNull();
  });

  it('leaves the grab handle off on request', () => {
    setup({ open: true, size: 'sheet', grab: false });
    expect(document.querySelector('.ui-dialog__grab')).toBeNull();
  });

  /**
   * Dropping the handle must drop only the handle: the handle is positioned on the panel's edge,
   * never in its flow, so the header's title, actions, inset and close control all stay put.
   */
  it('keeps the header, its actions, its inset and its close control when the handle goes', () => {
    setup({ open: true, size: 'sheet', grab: false });
    const panel = dialog();
    const header = document.querySelector('.ui-dialog__head')!;
    const body = document.querySelector('.ui-dialog__body')!;

    expect(screen.getByRole('heading', { level: 2, name: 'Custom repeat' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(header.classList.contains('border-b')).toBe(true);
    expect(panel.classList.contains('px-0')).toBe(true);
    expect(panel.classList.contains('pt-0')).toBe(true);
    expect(body.classList.contains('px-[var(--s4)]')).toBe(true);
  });

  it('keeps both actions on their edges when the handle is dropped', () => {
    setup({
      open: true,
      size: 'sheet',
      grab: false,
      leadingAction: <button type="button">Cancel</button>,
      trailingAction: <button type="button">Save</button>,
    });
    const header = document.querySelector('.ui-dialog__head')!;

    expect(document.querySelector('.ui-dialog__leading')!.textContent).toBe('Cancel');
    expect(header.contains(screen.getByRole('button', { name: 'Save' }))).toBe(true);
    expect(header.lastElementChild!.textContent).toBe('Save');
  });

  it("leaves the title at the row's start by default", () => {
    setup({ open: true, size: 'sheet', dismiss: false });
    const title = screen.getByRole('heading', { level: 2, name: 'Custom repeat' });
    const block = document.querySelector('.ui-dialog__title-block')!;

    expect(title.classList.contains('text-center')).toBe(false);
    expect(block.classList.contains('flex-1')).toBe(false);
  });

  it('centres the title, and only the title, on request', () => {
    setup({
      open: true,
      size: 'sheet',
      dismiss: false,
      titleAlign: 'center',
      description: 'The minutes you have sat are not saved.',
    });

    expect(
      screen
        .getByRole('heading', { level: 2, name: 'Custom repeat' })
        .classList.contains('text-center'),
    ).toBe(true);
    expect(document.querySelector('.ui-dialog__title-block')!.classList.contains('flex-1')).toBe(
      true,
    );
    // The copy under it keeps the column's start edge, which is where the design draws it.
    expect(
      screen.getByText('The minutes you have sat are not saved.').classList.contains('text-center'),
    ).toBe(false);
  });

  /**
   * The title is still what names the dialog when it moves, and a centred title in the three-column
   * header leaves the leading and trailing cells exactly where they were.
   */
  it('keeps the title the labelled element and both actions at their edges when centred', () => {
    setup({
      open: true,
      size: 'sheet',
      titleAlign: 'center',
      leadingAction: <button type="button">Cancel</button>,
      trailingAction: <button type="button">Save</button>,
    });
    const title = screen.getByRole('heading', { level: 2, name: 'Custom repeat' });
    const header = document.querySelector('.ui-dialog__head')!;

    expect(dialog().getAttribute('aria-labelledby')).toBe(title.getAttribute('id'));
    expect(header.classList.contains('grid-cols-[1fr_auto_1fr]')).toBe(true);
    expect(header.firstElementChild!.classList.contains('ui-dialog__leading')).toBe(true);
    expect(header.lastElementChild!.textContent).toBe('Save');
  });
});
