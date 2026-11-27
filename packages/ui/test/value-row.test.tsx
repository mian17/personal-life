import { fireEvent, render, screen } from '@testing-library/react';
import { ValueRow } from '../src/components/value-row';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean);
}

const row = () => document.querySelector('.ui-value-row')!;

describe('ValueRow', () => {
  it('renders the label and the read-out as plain text, outside the tab order', () => {
    render(<ValueRow label="Duration" value="10 min" />);

    expect(row().tagName).toBe('DIV');
    expect(screen.getByText('Duration')).toBeTruthy();
    expect(screen.getByText('10 min')).toBeTruthy();
    expect(row().hasAttribute('role')).toBe(false);
    expect(row().hasAttribute('tabindex')).toBe(false);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('makes the whole row one button in disclosure mode, named by its own text', () => {
    const onClick = jest.fn();
    render(<ValueRow label="Interval bells" value="Off" onClick={onClick} popup="dialog" />);

    const disclosure = screen.getByRole('button', { name: /Interval bells\s*Off/ });
    expect(disclosure.getAttribute('aria-haspopup')).toBe('dialog');

    fireEvent.click(disclosure);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('wires aria-controls only from the id it is given, so a closed sheet leaves no dangling IDREF', () => {
    const { unmount } = render(
      <ValueRow label="Interval bells" value="Off" onClick={() => {}} popup="dialog" />,
    );
    expect(screen.getByRole('button').hasAttribute('aria-controls')).toBe(false);
    unmount();

    render(
      <ValueRow
        label="Interval bells"
        value="Off"
        onClick={() => {}}
        popup="dialog"
        controls="interval-dialog"
      />,
    );
    expect(screen.getByRole('button').getAttribute('aria-controls')).toBe('interval-dialog');
  });

  it('claims no expanded state: a modal dialog is named by aria-haspopup', () => {
    render(<ValueRow label="Interval bells" value="Off" onClick={() => {}} popup="dialog" />);

    expect(screen.getByRole('button').hasAttribute('aria-expanded')).toBe(false);
  });

  it('hides the chevron from assistive tech and draws it only for a popup', () => {
    const { unmount } = render(<ValueRow label="Ending bell" value="Gong" />);
    expect(document.querySelector('.ui-value-row__chevron')).toBeNull();
    unmount();

    render(<ValueRow label="Interval bells" value="Off" onClick={() => {}} popup="menu" />);
    const chevron = document.querySelector('.ui-value-row__chevron')!;
    expect(chevron.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps a chevron on an inert row rather than turning it into a button', () => {
    render(<ValueRow label="Interval bells" value="Off" popup="dialog" />);

    expect(row().tagName).toBe('DIV');
    expect(document.querySelector('.ui-value-row__chevron')).not.toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders the control instead of a read-out and refuses the row-level action', () => {
    const onClick = jest.fn();
    render(
      <ValueRow
        label="Interval bells"
        value="Off"
        control={<button type="button">Switch</button>}
        onClick={onClick}
      />,
    );

    const control = screen.getByRole('button', { name: 'Switch' });
    expect(control.closest('.ui-value-row__control')).not.toBeNull();
    expect(screen.queryByText('Off')).toBeNull();
    expect(row().tagName).toBe('DIV');
  });

  it('selects one fill and one inset per tone', () => {
    const { unmount } = render(<ValueRow label="Duration" value="10 min" />);
    expect(classesOf(row())).toContain('bg-surface');
    expect(classesOf(row())).not.toContain('bg-surface-sunken');
    expect(classesOf(row())).toContain('pe-[var(--s4)]');
    unmount();

    render(<ValueRow label="Interval bells" control={<span />} tone="sunken" />);
    expect(classesOf(row())).toContain('bg-surface-sunken');
    expect(classesOf(row())).not.toContain('bg-surface');
    // The sunken row pulls its end inset one step tighter, and never carries both.
    expect(classesOf(row())).toContain('pe-[var(--s1)]');
    expect(classesOf(row())).not.toContain('pe-[var(--s4)]');
  });

  it('adds the pointer, the press wash and the focus ring in button mode', () => {
    render(<ValueRow label="Interval bells" value="Off" onClick={() => {}} popup="dialog" />);

    const classes = classesOf(row());
    expect(classes).toContain('cursor-pointer');
    expect(classes).toContain('active:bg-press');
    expect(classes).toContain('focus-visible:outline-[length:var(--focus-ring)]');
  });
});
