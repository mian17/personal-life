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
   * The sheet's copy sits one `--s1` under its title — the hairline step, not a full blank line.
   * The step is stated on the line, so the title keeps `m-0` alone.
   */
  it('spaces the description --s1 under the title', () => {
    setup({ open: true, description: 'One thing.' });
    const classes = classesOf(screen.getByText('One thing.'));
    expect(classes).toContain('mt-[var(--s1)]');
    expect(classes).not.toContain('mt-[var(--s4)]');
    expect(classes).toContain('m-0');
  });

  it("selects the sheet title's 700 weight rather than stacking it on the bold one", () => {
    setup({ open: true });
    const classes = classesOf(screen.getByRole('heading', { level: 2, name: 'Custom repeat' }));
    expect(classes).toContain('[font-weight:var(--fw-bold)]');
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

  /** One rhythm ships: `--s4` between the body's groups, on every size. */
  it('spaces the body at --s4', () => {
    setup({ open: true });
    const body = document.querySelector('.ui-dialog__body')!;

    expect(body.classList.contains('gap-[var(--s4)]')).toBe(true);
    expect(body.classList.contains('gap-[var(--s5)]')).toBe(false);
  });

  /**
   * The geometry move: the sheet's inline padding leaves the panel and lands on the slots, so a
   * slot can reach both edges, while the panel keeps its block inset — `--s2` above the grab.
   */
  it('moves the sheet inline padding from the panel to its slots', () => {
    setup({ open: true, size: 'sheet' });
    const panel = dialog();
    const body = document.querySelector('.ui-dialog__body')!;

    expect(panel.classList.contains('px-0')).toBe(true);
    expect(panel.classList.contains('pt-[var(--s2)]')).toBe(true);
    expect(
      panel.classList.contains(
        'p-[var(--s2)_var(--s4)_calc(var(--s6)+env(safe-area-inset-bottom))]',
      ),
    ).toBe(false);
    expect(body.classList.contains('px-[var(--s4)]')).toBe(true);
    expect(body.classList.contains('pb-[var(--s8)]')).toBe(true);
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
   * The grab is a row of its own at the panel's `--s2`: it costs the sheet 12px and centres its
   * `--s8`+`--s1` bar with `mx-auto` rather than an absolute offset.
   */
  it('draws the grab as a centred row above the header', () => {
    setup({ open: true, size: 'sheet' });
    const classes = classesOf(document.querySelector('.ui-dialog__grab')!);

    expect(classes).toContain('mt-[var(--s2)]');
    expect(classes).toContain('mx-auto');
    expect(classes).not.toContain('absolute');
  });

  /**
   * Every panel insets its header by `--s2`, so a sheet's title starts one grab-row-height below a
   * centred dialog's, and the sheet header draws no hairline.
   */
  it('insets the sheet header by --s2 and draws it no hairline', () => {
    setup({ open: true, size: 'sheet' });
    const header = classesOf(document.querySelector('.ui-dialog__head')!);

    expect(header).toContain('mt-[var(--s2)]');
    expect(header).toContain('px-[var(--s4)]');
    expect(header).not.toContain('border-b');
  });

  it('keeps the centred panel header inset', () => {
    setup({ open: true });
    expect(classesOf(document.querySelector('.ui-dialog__head')!)).toContain('mt-[var(--s2)]');
  });
});

describe('Dialog — one sheet geometry', () => {
  /**
   * A sheet's inset is the app's: `--s2` above the title, `--s4` at the sides, and the body `--s4`
   * under the header with `--s8` below. That is what every shipped sheet renders.
   */
  it("gives a sheet the app's inset on its header and its body", () => {
    setup({ open: true, size: 'sheet' });
    const header = classesOf(document.querySelector('.ui-dialog__head')!);
    const body = classesOf(document.querySelector('.ui-dialog__body')!);

    expect(header).toContain('mt-[var(--s2)]');
    expect(header).toContain('px-[var(--s4)]');
    expect(body).toContain('mt-[var(--s4)]');
    expect(body).toContain('gap-[var(--s4)]');
    expect(body).toContain('px-[var(--s4)]');
    expect(body).toContain('pb-[var(--s8)]');
  });

  /** The footer sits one `--s6` under the body, inset like the body beside it. */
  it('insets the sheet footer like the body, one --s6 under it', () => {
    setup({ open: true, size: 'sheet', footer: <span data-testid="footer" /> });
    const footer = classesOf(document.querySelector('.ui-dialog__footer')!);

    expect(footer).toContain('mt-[var(--s6)]');
    expect(footer).toContain('px-[var(--s4)]');
  });

  /** The confirm shape has no header row to inset: it keeps the panel's inset and draws no rule. */
  it('leaves the confirm shape on its own panel inset', () => {
    setup({ open: true, size: 'sheet', dismiss: false });
    const panel = classesOf(dialog());
    const header = classesOf(document.querySelector('.ui-dialog__head')!);

    expect(panel).toContain('pt-[var(--s6)]');
    expect(panel).toContain('px-[var(--s5)]');
    expect(header).not.toContain('border-b');
    expect(header.some((utility) => utility.startsWith('pt-'))).toBe(false);
  });
});

describe('Dialog — title alignment', () => {
  it('draws the sheet grab handle by default', () => {
    setup({ open: true, size: 'sheet' });
    expect(document.querySelector('.ui-dialog__grab')).not.toBeNull();
  });

  /**
   * The confirm shape is the one sheet with no handle: `dismiss={false}` drops it with the close
   * control, and the sheet keeps only its title, its copy and its answers.
   */
  it('leaves the grab handle off the confirm shape', () => {
    setup({ open: true, size: 'sheet', dismiss: false });
    expect(document.querySelector('.ui-dialog__grab')).toBeNull();
  });

  it('keeps both actions on their edges', () => {
    setup({
      open: true,
      size: 'sheet',
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
