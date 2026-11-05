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
