import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Button } from '../src/components/button';
import { Menu, MenuItem } from '../src/components/menu';

/**
 * Radix turns the popper offset into a `transform` only once it has positioned the panel against
 * a measured trigger, and jsdom measures nothing — the panel renders with no transform at all.
 * The one observable is therefore the prop `Menu` hands `DropdownMenuPrimitive.Content`, which
 * this passthrough records before the real primitive renders it. Every other case still runs
 * against the real primitive: the wrapper forwards its props untouched.
 */
const mockPanelSideOffsets: Array<number | undefined> = [];
jest.mock('@radix-ui/react-dropdown-menu', () => {
  const actual = jest.requireActual('@radix-ui/react-dropdown-menu');
  const { createElement } = jest.requireActual('react');
  return {
    ...actual,
    Content: (props: { sideOffset?: number }) => {
      mockPanelSideOffsets.push(props.sideOffset);
      return createElement(actual.Content, props);
    },
  };
});

/**
 * The registry trigger opens on a primary press, so a click alone would never reach it. jsdom
 * ships no `PointerEvent`, hence the mouse event carrying that type — it has the `button` the
 * trigger reads and nothing else the trigger needs.
 */
function press(node: HTMLElement) {
  fireEvent(node, new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
}

const trigger = () => screen.getByRole('button', { name: 'Actions for Groceries' });

/** Radix attaches its outside-press listener a tick after the panel mounts. */
async function settleDismissLayer() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

function Harness({ disabled = false }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Menu
        label="Actions for Groceries"
        summary="Groceries"
        open={open}
        onOpenChange={setOpen}
        disabled={disabled}
      >
        <button type="button">Rename</button>
      </Menu>
      <button type="button">Outside</button>
    </div>
  );
}

function ItemHarness() {
  const [open, setOpen] = useState(false);
  return (
    <Menu label="Actions for Groceries" summary="Groceries" open={open} onOpenChange={setOpen}>
      <MenuItem>
        <Button variant="danger" size="bare">
          Delete note
        </Button>
      </MenuItem>
    </Menu>
  );
}

function SoloHarness() {
  const [open, setOpen] = useState(false);
  return (
    <Menu label="Note actions" open={open} onOpenChange={setOpen}>
      <button type="button">Delete note</button>
    </Menu>
  );
}

describe('Menu', () => {
  it('renders the trigger alone when no summary is given', () => {
    render(<SoloHarness />);
    const button = screen.getByRole('button', { name: 'Note actions' });
    expect(button.closest('.ui-menu__summary')).toBeNull();
    expect(button.closest('.ui-menu__label')).toBeNull();
  });

  it('renders the summary and a closed trigger', () => {
    render(<Harness />);
    expect(screen.getByText('Groceries')).toBeTruthy();
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens the panel on a primary press of the trigger', () => {
    render(<Harness />);
    press(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('closes on Escape', () => {
    render(<Harness />);
    press(trigger());
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on an outside press', async () => {
    render(<Harness />);
    press(trigger());
    await settleDismissLayer();
    press(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does not close on a press inside the menu', () => {
    render(<Harness />);
    press(trigger());
    press(screen.getByRole('menu'));
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('gives a MenuItem-wrapped Button the menu item role and its text as the name', () => {
    // A plain button dropped into the panel is only a button: no `menuitem` role, so no Arrow
    // movement between entries. Radix's `Item` supplies both, and `asChild` keeps the button.
    render(<ItemHarness />);
    press(trigger());
    expect(screen.getByRole('menuitem', { name: 'Delete note' })).toBeTruthy();
  });

  it('takes the trigger face and glyph from its props, defaulting to the borderless vertical ellipsis', () => {
    const framed = render(
      <Menu
        label="Note actions"
        open={false}
        onOpenChange={() => {}}
        triggerVariant="framed"
        triggerIcon={<span data-testid="horizontal-dots" />}
      >
        <button type="button">Delete note</button>
      </Menu>,
    );
    const framedTrigger = within(framed.container).getByRole('button', { name: 'Note actions' });
    expect(framedTrigger.classList.contains('ui-icon-btn--framed')).toBe(true);
    expect(framedTrigger.contains(framed.getByTestId('horizontal-dots'))).toBe(true);

    const plain = render(
      <Menu label="Note actions" open={false} onOpenChange={() => {}}>
        <button type="button">Delete note</button>
      </Menu>,
    );
    const defaultTrigger = within(plain.container).getByRole('button', { name: 'Note actions' });
    expect(defaultTrigger.classList.contains('ui-icon-btn--framed')).toBe(false);
    expect(defaultTrigger.classList.contains('border-0')).toBe(true);
    expect(defaultTrigger.querySelector('svg')).not.toBeNull();
  });

  it('offsets the panel from its trigger by the `--s2` step', () => {
    mockPanelSideOffsets.length = 0;
    render(<SoloHarness />);
    press(screen.getByRole('button', { name: 'Note actions' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(mockPanelSideOffsets.length).toBeGreaterThan(0);
    expect(mockPanelSideOffsets.every((offset) => offset === 8)).toBe(true);
  });

  it('disables the trigger', () => {
    render(<Harness disabled />);
    expect((trigger() as HTMLButtonElement).disabled).toBe(true);
  });
});

function RowItemHarness() {
  const [open, setOpen] = useState(false);
  return (
    <Menu label="Note actions" open={open} onOpenChange={setOpen}>
      <MenuItem size="row">
        <button type="button">Reset settings</button>
      </MenuItem>
    </Menu>
  );
}

function DensityHarness({ density }: Readonly<{ density: 'default' | 'compact' }>) {
  const [open, setOpen] = useState(false);
  return (
    <Menu
      label="Actions for Groceries"
      summary="Groceries"
      open={open}
      onOpenChange={setOpen}
      density={density}
    >
      <MenuItem>
        <button type="button">Rename</button>
      </MenuItem>
    </Menu>
  );
}

describe('Menu — trigger shape, panel density and item size', () => {
  it('keeps the library --r-md corner on the trigger by default', () => {
    render(<SoloHarness />);
    const classes = screen.getByRole('button', { name: 'Note actions' }).classList;
    expect(classes.contains('rounded-[var(--r-md)]')).toBe(true);
    expect(classes.contains('rounded-[var(--r-pill)]')).toBe(false);
  });

  it('matches a header overflow control to the action language with triggerShape="pill"', () => {
    render(
      <Menu label="More actions" open={false} onOpenChange={() => {}} triggerShape="pill">
        <MenuItem>
          <button type="button">Reset settings</button>
        </MenuItem>
      </Menu>,
    );
    const classes = screen.getByRole('button', { name: 'More actions' }).classList;
    expect(classes.contains('rounded-[var(--r-pill)]')).toBe(true);
    expect(classes.contains('rounded-[var(--r-md)]')).toBe(false);
    expect(classes.contains('size-[var(--tap)]')).toBe(true);
  });

  it('keeps the raised --r-lg/--s2 panel by default', () => {
    render(<DensityHarness density="default" />);
    press(trigger());
    const classes = document.querySelector('.ui-menu__panel')!.classList;
    expect(classes.contains('p-[var(--s2)]')).toBe(true);
    expect(classes.contains('rounded-[var(--r-lg)]')).toBe(true);
  });

  it('selects the tighter secondary surface at density="compact", never two of each', () => {
    render(<DensityHarness density="compact" />);
    press(trigger());
    const classes = document.querySelector('.ui-menu__panel')!.classList;
    expect(classes.contains('p-[var(--s1)]')).toBe(true);
    expect(classes.contains('rounded-[var(--r-md)]')).toBe(true);
    expect(classes.contains('p-[var(--s2)]')).toBe(false);
    expect(classes.contains('rounded-[var(--r-lg)]')).toBe(false);
  });

  it('paints the tap-height row on a row-sized item', () => {
    render(<RowItemHarness />);
    press(screen.getByRole('button', { name: 'Note actions' }));
    const item = screen.getByRole('menuitem', { name: 'Reset settings' });
    expect(item.classList.contains('min-h-[var(--tap)]')).toBe(true);
    expect(item.classList.contains('px-[var(--s4)]')).toBe(true);
    expect(item.classList.contains('rounded-[var(--r-sm)]')).toBe(true);
    expect(item.classList.contains('text-start')).toBe(true);
  });

  it('adds nothing to a bare item, which still draws itself', () => {
    render(<ItemHarness />);
    press(trigger());
    const item = screen.getByRole('menuitem', { name: 'Delete note' });
    expect(item.classList.contains('px-[var(--s4)]')).toBe(false);
    expect(item.classList.contains('rounded-[var(--r-sm)]')).toBe(false);
    expect(item.classList.contains('min-h-[var(--tap)]')).toBe(true);
  });
});
