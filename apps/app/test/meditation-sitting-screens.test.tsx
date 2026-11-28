/**
 * @jest-environment jsdom
 *
 * The two resting screens (`SPEC-ui-meditation-primitives` §1, §11, §12): the running panel with
 * its one quiet Stop, the confirm sheet that asks before it ends anything, and the complete panel
 * the record lands on.
 *
 * The names asserted here are the design's own (`preview/index.html:92-113`, `:235-243`) — a
 * paraphrase would pass in code review and break the screen reader, so each is spelled out. The
 * clock assertions are the point of the sheet cases: dismissing it, in any of its three ways, must
 * leave the countdown exactly where it was.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CompleteSitting } from '@/app/meditation/complete-sitting';
import { RunningSitting, type RunningSittingProps } from '@/app/meditation/running-sitting';
import { SittingTimer } from '@/app/meditation/sitting-timer';
import type { BellChoice } from '@/lib/meditation-clock';
import { MEDITATION_LENGTH_KEY } from '@/lib/meditation-length';

const refresh = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

jest.mock('../app/meditation/actions', () => ({
  recordFinishedSitting: jest.fn(),
  recordKeptSitting: jest.fn(),
}));

import { recordKeptSitting } from '../app/meditation/actions';

const recordKept = recordKeptSitting as jest.Mock;

/** The bells off: this screen's cases are about the clock, not the bowls. */
const BELLS_OFF: BellChoice = { enabled: false, offsetSec: 0, intervalSec: 600, repeat: null };

/** The instant every case starts from, pinned so a fake tick is a whole second. */
const START_MS = 1_000_000;

const PLANNED_MINUTES = 10;

/** The timer as the route hands it in: a plan, and the length this browser chose when a case says so. */
function renderTimer(rememberedMinutes: number | null = null) {
  return render(
    <SittingTimer
      bells={BELLS_OFF}
      plannedMinutes={PLANNED_MINUTES}
      rememberedMinutes={rememberedMinutes}
    />,
  );
}

/** The length cookie as the browser kept it, so a step's write is read the way the server reads it. */
function rememberedCookie(): string | null {
  const entry = document.cookie
    .split('; ')
    .find((pair) => pair.startsWith(`${MEDITATION_LENGTH_KEY}=`));
  return entry === undefined ? null : entry.slice(MEDITATION_LENGTH_KEY.length + 1);
}

const elapsed = 60_000;

function renderRunning(overrides: Partial<RunningSittingProps> = {}) {
  const props: RunningSittingProps = {
    startedAtMs: START_MS,
    plannedMinutes: PLANNED_MINUTES,
    bells: BELLS_OFF,
    onFinish: jest.fn(),
    onEnd: jest.fn(),
    ...overrides,
  };

  return { props, ...render(<RunningSitting {...props} />) };
}

const countdown = () => screen.getByRole('status');
/** The complete panel's figure: the same status element, written once as a result. */
const figure = () => screen.getByRole('status');
const progress = () => screen.getByRole('progressbar', { name: 'Session progress' });
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });

/** One second of the sitting's own clock, with the repaint it causes. */
function tick(ms: number): void {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(START_MS);
  refresh.mockReset();
  recordKept.mockReset();
  document.cookie = `${MEDITATION_LENGTH_KEY}=;path=/;max-age=0`;
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe('the running panel', () => {
  it('draws the session line, the countdown, the named track and one quiet Stop', () => {
    renderRunning();

    expect(screen.getByText('Meditation · 10 min')).toBeTruthy();
    expect(countdown().textContent).toBe('10:00');
    expect(countdown().getAttribute('aria-live')).toBe('polite');
    expect(progress().getAttribute('aria-valuenow')).toBe('0');
    expect(screen.getAllByRole('button').map((control) => control.textContent)).toEqual(['Stop']);
  });

  it('fills the track as the sitting is sat', () => {
    renderRunning();

    tick(elapsed);

    expect(countdown().textContent).toBe('9:00');
    expect(progress().getAttribute('aria-valuenow')).toBe('10');
  });

  /**
   * The panel is the centred `Stack`, named by the landmark above it: no layout class is stated
   * here, and the centred mode is what puts the children on both axes.
   */
  it('lays the panel out as a centred Stack inside its named region', () => {
    renderRunning();

    const region = screen.getByRole('region', { name: 'Session in progress' });
    const panel = region.querySelector('.ui-stack--centred');

    expect(panel).not.toBeNull();
    expect(region.className).toBe('');
    expect(panel!.classList.contains('gap-[var(--s6)]')).toBe(true);
    expect(panel!.classList.contains('py-[var(--s8)]')).toBe(true);
  });
});

describe('the stop sheet', () => {
  it('asks the design’s question, with its copy and its two answers, and no close control', () => {
    renderRunning();

    fireEvent.click(button('Stop'));

    const sheet = screen.getByRole('dialog');
    expect(sheet.className).toContain('ui-dialog--sheet');
    expect(sheet.querySelector('.ui-dialog__grab')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.getByText('End this session?')).toBeTruthy();
    expect(screen.getByText('The minutes you have sat are not saved.')).toBeTruthy();
    expect(button('Keep going')).toBeTruthy();
    expect(button('End session')).toBeTruthy();
  });

  it('takes focus into the sheet when it opens', () => {
    renderRunning();

    fireEvent.click(button('Stop'));

    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('closes on Keep going and leaves the clock where it stood', () => {
    renderRunning();
    tick(elapsed);

    fireEvent.click(button('Stop'));
    fireEvent.click(button('Keep going'));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(countdown().textContent).toBe('9:00');

    tick(1_000);
    expect(countdown().textContent).toBe('8:59');
  });

  it('closes on Escape the way Keep going does, never ending the sitting', () => {
    renderRunning();
    tick(elapsed);

    fireEvent.click(button('Stop'));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(countdown().textContent).toBe('9:00');
  });

  it('hands End session the seconds sat', () => {
    const { props } = renderRunning();
    tick(65_000);

    fireEvent.click(button('Stop'));
    fireEvent.click(button('End session'));

    expect(props.onEnd).toHaveBeenCalledWith(65);
  });
});

describe('the complete panel', () => {
  it('reads the finished sitting as the design does', () => {
    const onDone = jest.fn();
    render(<CompleteSitting result={{ minutes: 10, completed: true }} onDone={onDone} />);

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Session complete');
    expect(figure().textContent).toBe('10 min');
    expect(screen.getByText('minutes sat')).toBeTruthy();

    fireEvent.click(button('Done'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('names an early end for what it was, over the minutes it kept', () => {
    render(<CompleteSitting result={{ minutes: 4, completed: false }} onDone={jest.fn()} />);

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Session ended early');
    expect(figure().textContent).toBe('4 min');
    expect(screen.getByText('minutes sat')).toBeTruthy();
  });

  /** Its heading is the name, so the panel is the centred Stack itself and no landmark wraps it. */
  it('lays the panel out as a centred Stack with no landmark around it', () => {
    render(<CompleteSitting result={{ minutes: 10, completed: true }} onDone={jest.fn()} />);

    const panel = screen.getByRole('heading', { level: 2 }).closest('.ui-stack--centred');

    expect(panel).not.toBeNull();
    expect(panel!.classList.contains('gap-[var(--s6)]')).toBe(true);
    expect(panel!.classList.contains('py-[var(--s8)]')).toBe(true);
    expect(screen.queryByRole('region')).toBeNull();
  });
});

describe('a sitting driven end to end', () => {
  it('records a stopped sitting as kept, completes it, and re-reads the day on Done', async () => {
    renderTimer();

    fireEvent.click(button('Start'));
    tick(elapsed);
    fireEvent.click(button('Stop'));
    await act(async () => {
      fireEvent.click(button('End session'));
    });

    expect(recordKept).toHaveBeenCalledWith({
      startedAt: new Date(START_MS).toISOString(),
      plannedMinutes: PLANNED_MINUTES,
      elapsedSeconds: 60,
    });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Session ended early');
    expect(figure().textContent).toBe('1 min');

    fireEvent.click(button('Done'));

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(button('Start')).toBeTruthy();
  });

  it('opens the stepper on the plan the first visit has no memory of', () => {
    renderTimer();

    expect(screen.getByText('10 min')).toBeTruthy();
  });

  it('opens the stepper where this browser last left off, the stored plan notwithstanding', () => {
    renderTimer(23);

    expect(screen.getByText('23 min')).toBeTruthy();
  });

  /**
   * The point of reading the cookie on the server: the first render already carries the remembered
   * length, so no frame ever shows the plan and corrects itself.
   */
  it('shows the remembered length on its first render, with nothing in the browser to read', () => {
    expect(rememberedCookie()).toBeNull();

    renderTimer(21);

    expect(screen.getByText('21 min')).toBeTruthy();
    expect(button('Decrease duration by one minute')).toHaveProperty('disabled', false);
  });

  it('opens on a remembered single minute, and on the floor when the memory is too small', () => {
    renderTimer(1);

    expect(screen.getByText('1 min')).toBeTruthy();
    expect(button('Decrease duration by one minute')).toHaveProperty('disabled', true);
  });

  /** A refresh before Start must show the length last set, so a step writes itself into the cookie. */
  it('remembers a stepped length the moment it changes, before any Start', () => {
    renderTimer();

    fireEvent.click(button('Increase duration by one minute'));

    expect(rememberedCookie()).toBe('11');
    expect(screen.getByText('11 min')).toBeTruthy();
  });

  it('remembers the length the sitter started in this browser, and starts the sitting', () => {
    renderTimer();

    fireEvent.click(button('Increase duration by one minute'));
    fireEvent.click(button('Start'));

    expect(rememberedCookie()).toBe('11');
    expect(countdown().textContent).toBe('11:00');
  });

  /** The sitting is the product; a browser that refuses to remember may not keep it from starting. */
  it('starts the sitting even when the browser refuses to remember the length', () => {
    const refuse = jest.spyOn(Document.prototype, 'cookie', 'set').mockImplementation(() => {
      throw new Error('cookies refused');
    });
    renderTimer();

    fireEvent.click(button('Start'));

    expect(countdown().textContent).toBe('10:00');
    expect(button('Stop')).toBeTruthy();

    refuse.mockRestore();
  });

  it('sets the idle blocks on the section rhythm and the rows on their own nested one', () => {
    renderTimer();

    const setup = screen.getByRole('region', { name: 'Session setup' });
    const [blocks] = Array.from(setup.children);
    const rows = screen.getByText('Ending bell').closest('.ui-stack--md');

    expect(blocks.classList.contains('ui-stack--lg')).toBe(true);
    expect(rows).not.toBeNull();
    expect(rows).not.toBe(blocks);
  });
});
