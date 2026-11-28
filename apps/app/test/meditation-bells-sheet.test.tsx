/**
 * @jest-environment jsdom
 *
 * The interval bells sheet, driven the way the owner drives it: the switch reveals the groups,
 * a field or a press rewrites the summary, the close control discards and Save hands the draft on.
 *
 * The names asserted here are the preview's own (`preview/index.html:117-233`) — a paraphrase
 * would pass in code review and break the screen reader, so each is spelled out. Nothing is
 * written on a press: the write happens on Save alone, which the spy proves by counting calls.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IntervalBellsSheet, type SaveBells } from '@/app/meditation/interval-bells-sheet';
import { IdleScreen } from '@/app/meditation/idle-screen';
import type { BellChoice } from '@/lib/meditation-clock';

/** The service's defaults: bells off, nothing chosen. */
const SAVED_OFF: BellChoice = { enabled: false, offsetSec: 0, intervalSec: 600, repeat: null };

/** A stored schedule, so every control has a saved value to open on. */
const SAVED_ON: BellChoice = { enabled: true, offsetSec: 300, intervalSec: 600, repeat: 2 };

const SESSION_MINUTES = 30;

interface SheetOptions {
  bells?: BellChoice;
  open?: boolean;
  onSave?: SaveBells;
}

/** The sheet as it renders, with its write and its close observed. */
function renderSheet({ bells = SAVED_ON, open = true, onSave }: Readonly<SheetOptions> = {}) {
  const write = jest.fn(onSave ?? (async (_bells: BellChoice) => undefined));
  const onClose = jest.fn();

  const view = render(
    <IntervalBellsSheet
      id="interval-dialog"
      open={open}
      bells={bells}
      sessionMinutes={SESSION_MINUTES}
      onSave={write}
      onClose={onClose}
    />,
  );

  return { onSave: write, onClose, ...view };
}

const field = (name: string) => screen.getByLabelText<HTMLInputElement>(name);
const button = (name: string | RegExp) => screen.getByRole<HTMLButtonElement>('button', { name });
const switchOf = () => screen.getByRole('switch', { name: 'Interval bells' });
const summary = () => document.querySelector('.ui-caption')?.textContent;

/** Whether `first` reads above `second` in document order. */
function precedes(first: Node, second: Node): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

afterEach(cleanup);

describe('the sheet', () => {
  it('opens as a bottom sheet with its close control, its title and a Save in the footer', () => {
    renderSheet();

    expect(screen.getByRole('dialog').className).toContain('ui-dialog--sheet');
    expect(button('Close')).toBeTruthy();
    expect(button('Save')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Interval bells' })).toBeTruthy();
    expect(document.querySelector('.ui-dialog__footer')!.contains(button('Save'))).toBe(true);
  });

  it('is the element the row announces, while it is mounted', () => {
    const { rerender } = renderSheet({ open: false });
    expect(document.getElementById('interval-dialog')).toBeNull();

    rerender(
      <IntervalBellsSheet
        id="interval-dialog"
        open
        bells={SAVED_ON}
        sessionMinutes={SESSION_MINUTES}
        onSave={async () => undefined}
        onClose={() => undefined}
      />,
    );
    expect(document.getElementById('interval-dialog')).not.toBeNull();
  });

  it('opens on the saved bells and keeps everything but the switch out of view while off', () => {
    renderSheet({ bells: SAVED_OFF });

    expect(switchOf().getAttribute('aria-checked')).toBe('false');
    expect(
      screen.queryByRole('button', { name: 'Decrease start offset by one minute' }),
    ).toBeNull();
    expect(screen.queryByText(/^Every \d+ min$/)).toBeNull();
    expect(screen.queryByRole('group', { name: 'Repeat' })).toBeNull();
    expect(summary()).toBeUndefined();
  });

  it('reveals the four groups from the switch, and derives the summary from the draft', () => {
    renderSheet({ bells: SAVED_OFF });
    fireEvent.click(switchOf());

    expect(switchOf().getAttribute('aria-checked')).toBe('true');
    expect(summary()).toBe(
      'Bowl every 10 min, starting after 0 min, unlimited. 3 bowls this session.',
    );
    expect(screen.getByRole('group', { name: 'Repeat' })).toBeTruthy();
  });

  it('reads the summary as the schedule headline, under the switch and above the groups', () => {
    renderSheet();

    const caption = document.querySelector('.ui-caption')!;
    expect(precedes(switchOf(), caption)).toBe(true);
    expect(precedes(caption, screen.getByRole('heading', { level: 3, name: 'Start after' }))).toBe(
      true,
    );
  });

  it("names the offset pair and the three fields with the preview's own words", () => {
    renderSheet();

    expect(button('Decrease start offset by one minute').disabled).toBe(false);
    expect(button('Increase start offset by one minute').disabled).toBe(false);
    expect(field('Start offset hours').value).toBe('0');
    expect(field('Start offset minutes').value).toBe('5');
    expect(field('Start offset seconds').value).toBe('0');
  });

  it('reads the interval the service can store: every ten minutes, ten minutes a press', () => {
    renderSheet();

    expect(screen.getByText('Every 10 min')).toBeTruthy();
    expect(button('Decrease interval by one minute').disabled).toBe(true);

    fireEvent.click(button('Increase interval by one minute'));
    expect(screen.getByText('Every 20 min')).toBeTruthy();
    expect(button('Decrease interval by one minute').disabled).toBe(false);
  });

  it('stops the interval at the top of the service grid', () => {
    renderSheet();
    for (let press = 0; press < 11; press += 1) {
      fireEvent.click(button('Increase interval by one minute'));
    }

    expect(screen.getByText('Every 120 min')).toBeTruthy();
    expect(button('Increase interval by one minute').disabled).toBe(true);
  });

  it('moves the whole offset a minute with the pair, down to zero and no further', () => {
    renderSheet();

    fireEvent.click(button('Decrease start offset by one minute'));
    expect(field('Start offset minutes').value).toBe('4');
    expect(summary()).toContain('starting after 4 min');

    for (let press = 0; press < 4; press += 1) {
      fireEvent.click(button('Decrease start offset by one minute'));
    }
    expect(field('Start offset minutes').value).toBe('0');
    expect(button('Decrease start offset by one minute').disabled).toBe(true);
  });

  it('rewrites the summary from the fields on every keystroke, saved values or not', () => {
    renderSheet();

    fireEvent.change(field('Start offset hours'), { target: { value: '1' } });

    expect(field('Start offset hours').value).toBe('1');
    expect(summary()).toBe(
      'Bowl every 10 min, starting after 1 h 5 min, 2× — no bowl will sound in a 30 min session.',
    );
  });

  it('offers the service repeat choices as one pressed run of seven', () => {
    renderSheet();

    expect(screen.getByRole('group', { name: 'Repeat' }).querySelectorAll('button')).toHaveLength(
      7,
    );
    expect(button('Repeat: 2×').getAttribute('aria-pressed')).toBe('true');
    expect(button('Repeat: unlimited').getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(button('Repeat: unlimited'));

    expect(button('Repeat: unlimited').getAttribute('aria-pressed')).toBe('true');
    expect(button('Repeat: 2×').getAttribute('aria-pressed')).toBe('false');
    expect(summary()).toBe(
      'Bowl every 10 min, starting after 5 min, unlimited. 3 bowls this session.',
    );
  });

  it('writes nothing on a press, and hands the draft over in seconds only on Save', async () => {
    const { onSave, onClose } = renderSheet();

    fireEvent.click(button('Increase interval by one minute'));
    fireEvent.change(field('Start offset minutes'), { target: { value: '6' } });
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(button('Save'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      enabled: true,
      offsetSec: 360,
      intervalSec: 1200,
      repeat: 2,
    });
  });

  it('discards the draft on a dismissal: a reopen shows the saved bells again', () => {
    const { onClose, rerender } = renderSheet();

    fireEvent.change(field('Start offset minutes'), { target: { value: '9' } });
    fireEvent.click(button('Close'));

    expect(onClose).toHaveBeenCalledTimes(1);

    const reopened = (open: boolean) => (
      <IntervalBellsSheet
        id="interval-dialog"
        open={open}
        bells={SAVED_ON}
        sessionMinutes={SESSION_MINUTES}
        onSave={async () => undefined}
        onClose={() => undefined}
      />
    );
    rerender(reopened(false));
    rerender(reopened(true));

    expect(switchOf().getAttribute('aria-checked')).toBe('true');
    expect(field('Start offset minutes').value).toBe('5');
    expect(screen.getByText('Every 10 min')).toBeTruthy();
    expect(button('Repeat: 2×').getAttribute('aria-pressed')).toBe('true');
  });

  it('closes on Escape as a dismissal, writing nothing', () => {
    const { onClose, onSave } = renderSheet();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('holds Save inert until a write is wired in', () => {
    render(
      <IntervalBellsSheet
        id="interval-dialog"
        open
        bells={SAVED_OFF}
        sessionMinutes={SESSION_MINUTES}
        onClose={() => undefined}
      />,
    );

    expect(button('Save').disabled).toBe(true);
  });
});

describe("the idle screen's Interval bells row", () => {
  function renderIdle(): void {
    render(
      <IdleScreen
        plannedMinutes={SESSION_MINUTES}
        bells={SAVED_ON}
        onStart={() => undefined}
        onSaveBells={async () => undefined}
      />,
    );
  }

  it('announces the sheet it opens, and opens it', () => {
    renderIdle();
    const row = button(/^Interval bells/);

    expect(row.getAttribute('aria-haspopup')).toBe('dialog');
    expect(row.getAttribute('aria-controls')).toBe('interval-dialog');
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(row);

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(document.getElementById('interval-dialog')).not.toBeNull();
  });

  it('hands focus back to the row when the sheet closes', () => {
    renderIdle();
    const row = button(/^Interval bells/);
    row.focus();
    fireEvent.click(row);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it('keeps reading the saved bells while the draft is edited', () => {
    renderIdle();
    expect(screen.getByText('Every 10 min')).toBeTruthy();

    fireEvent.click(button(/^Interval bells/));
    fireEvent.click(button('Increase interval by one minute'));

    expect(screen.getByText('Every 20 min')).toBeTruthy();
    expect(screen.getByText('Every 10 min')).toBeTruthy();

    fireEvent.click(button('Close'));

    expect(screen.getByText('Every 10 min')).toBeTruthy();
    expect(screen.queryByText('Every 20 min')).toBeNull();
  });
});
