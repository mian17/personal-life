import { ApiError } from '@/lib/api-error';

// The server-action seams, mocked exactly like `meal-saved.test.tsx`; the
// action's own branches (revalidate + failure mapping) are covered here because
// the plan keeps action wiring in this one inbox suite (`SPEC-feedback-status`
// §6; no separate suite).
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('next/navigation', () => ({
  // Faithful to Next's helper: only a Next-internal thrown value (one carrying a
  // `digest`) is rethrown; anything else is a normal application error.
  unstable_rethrow: (error: unknown) => {
    if (error != null && typeof error === 'object' && 'digest' in error) throw error;
  },
}));
jest.mock('@/lib/feedback-api', () => ({
  createFeedback: jest.fn(),
  updateFeedbackStatus: jest.fn(),
}));

import type { CreateFeedbackInput, FeedbackDto, FeedbackSubmitResult } from '@life/shared';
import { AlertBanner, FeedbackNavItem, Select } from '@life/ui';
import { renderToStaticMarkup } from 'react-dom/server';
import { revalidatePath } from 'next/cache';
import { createFeedback, updateFeedbackStatus } from '@/lib/feedback-api';
import { setFeedbackStatusAction, submitFeedbackAction } from '../app/feedback-actions';
import { FeedbackInbox } from '../app/feedback-inbox';

const mockedCreateFeedback = createFeedback as jest.MockedFunction<typeof createFeedback>;
const mockedUpdateFeedbackStatus = updateFeedbackStatus as jest.MockedFunction<
  typeof updateFeedbackStatus
>;
const mockedRevalidatePath = revalidatePath as jest.MockedFunction<typeof revalidatePath>;

const noopAction = async (_input: CreateFeedbackInput): Promise<FeedbackSubmitResult> => ({
  ok: true,
  id: 'x',
});

const noopStatusAction = async (
  _id: string,
  _status: FeedbackDto['status'],
): Promise<FeedbackSubmitResult> => ({ ok: true, id: _id });

const STATUS_FAILURE = "Couldn't update status. Try again.";

/** The plain string the server page assembles and hands across the boundary. */
const SETTINGS_HREF = '/feedback/settings';

function fb(
  overrides: Partial<FeedbackDto> &
    Pick<FeedbackDto, 'id' | 'app' | 'type' | 'title' | 'description' | 'status'>,
) {
  return { createdAt: '2026-10-03T00:00:00.000Z', ...overrides } satisfies FeedbackDto;
}

function headings(html: string, level: 'h2' | 'h3'): string[] {
  return [...html.matchAll(new RegExp(`<${level} class="ui-section__heading">([^<]*)</${level}>`, 'g'))].map(
    (m) => m[1],
  );
}

function rowTitles(html: string): string[] {
  return [
    ...html.matchAll(/class="ui-list-item__title(?: ui-list-item__title--with-action)?"[^>]*>([^<]*)</g),
  ].map((m) => m[1]);
}

function rowSnippets(html: string): string[] {
  return [...html.matchAll(/ui-list-item__snippet">([^<]*)</g)].map((m) => m[1]);
}

function render(entries: FeedbackDto[]): string {
  return renderToStaticMarkup(
    <FeedbackInbox
      entries={entries}
      settingsHref={SETTINGS_HREF}
      submitFeedbackAction={noopAction}
      setFeedbackStatusAction={noopStatusAction}
    />,
  );
}

/**
 * The same inbox render under a preset filter. `useState` is answered off the
 * raw react module (the push-toggle/meal-editor pattern): the first hook is the
 * filter, so seeding slot 0 sets it — the component code itself is exercised
 * untouched.
 */
function renderWithFilter(entries: FeedbackDto[], filter: FeedbackDto['status'] | null): string {
  const { spy, setIndex } = slotSpy(filter);
  try {
    setIndex(0);
    return renderToStaticMarkup(
      <FeedbackInbox
        entries={entries}
        settingsHref={SETTINGS_HREF}
        submitFeedbackAction={noopAction}
        setFeedbackStatusAction={noopStatusAction}
      />,
    );
  } finally {
    spy.mockRestore();
  }
}

/**
 * The status vocabulary's rendering contract, read back from the DOM: the pill
 * on the title line (the `<span>` chain `ListItem variant="feedback"` renders
 * ahead of the row dropdown).
 */
function statusPill(html: string, title: string): { class: string; label: string } | undefined {
  const row = html.slice(html.indexOf(title));
  const match = row.match(/class="([^"]*ui-pill--(?:open|in_progress|done|wont_do)[^"]*)"[^>]*>([^<]*)<\/span>/);
  return match ? { class: match[1], label: match[2].replace(/&#x27;/g, "'") } : undefined;
}

/** The row dropdown's accessible name — the entry's title names the control. */
function statusSelect(html: string, title: string): string | undefined {
  return html.match(new RegExp(`aria-label="Set status for ${title}"`))?.[0];
}

// Newest-first as feedback-service returns them; encounter order is the
// newest-first order the inbox must preserve inside every bucket. Statuses
// exercise all four vocabulary values.
const ENTRIES: FeedbackDto[] = [
  fb({ id: '1', app: 'feedback', type: 'feature_request', title: 'fb feat title', description: 'fb feat new', status: 'open' }),
  fb({ id: '2', app: 'todos', type: 'bug_report', title: 'todos bug title', description: 'todos bug', status: 'in_progress' }),
  fb({ id: '3', app: 'notes', type: 'bug_report', title: 'notes bug title', description: 'notes bug', status: 'done' }),
  fb({ id: '4', app: 'feedback', type: 'feature_request', title: 'fb feat old title', description: 'fb feat old', status: 'wont_do' }),
  fb({ id: '5', app: 'todos', type: 'feature_request', title: 'todos feat title', description: 'todos feat', status: 'open' }),
  fb({ id: '6', app: 'notes', type: 'feature_request', title: 'notes feat title', description: 'notes feat', status: 'open' }),
];

describe('FeedbackInbox grouping', () => {
  it('nests app then type, in canonical order, preserving newest-first inside groups', () => {
    const html = render(ENTRIES);

    expect(headings(html, 'h2')).toEqual(['Notes', 'Todos', 'Feedback']);
    // Types render canonical (feature_request → bug_report) within each app.
    expect(headings(html, 'h3')).toEqual([
      'Feature request',
      'Bug report',
      'Feature request',
      'Bug report',
      'Feature request',
    ]);
    // Rows follow the group tree, newest-first inside the Feedback group.
    expect(rowTitles(html)).toEqual([
      'notes feat title',
      'notes bug title',
      'todos feat title',
      'todos bug title',
      'fb feat title',
      'fb feat old title',
    ]);
    // The description renders in the row's secondary line, beneath the title.
    expect(rowSnippets(html)).toEqual([
      'notes feat',
      'notes bug',
      'todos feat',
      'todos bug',
      'fb feat new',
      'fb feat old',
    ]);
  });

  it('sorts unknown app ids last (alphabetical) and unknown types last', () => {
    const html = render([
      fb({ id: '1', app: 'zeta', type: 'question', title: 'zt', description: 'z', status: 'open' }),
      fb({ id: '2', app: 'notes', type: 'enhancement', title: 'nt', description: 'n', status: 'open' }),
      fb({ id: '3', app: 'alpha', type: 'bug_report', title: 'at', description: 'a', status: 'open' }),
      fb({ id: '4', app: 'notes', type: 'zzz', title: 'n2t', description: 'n2', status: 'open' }),
    ]);

    expect(headings(html, 'h2')).toEqual(['Notes', 'alpha', 'zeta']);
    expect(headings(html, 'h3')).toEqual(['Enhancement', 'zzz', 'Bug report', 'question']);
  });

  it('falls back to the raw id for an unknown app or type', () => {
    const html = render([
      fb({ id: '1', app: 'analytics', type: 'question', title: 'at', description: 'x', status: 'open' }),
    ]);

    expect(headings(html, 'h2')).toEqual(['analytics']);
    expect(headings(html, 'h3')).toEqual(['question']);
  });

  it('renders one EmptyState and no list when there are zero entries', () => {
    const html = render([]);

    expect(html).toContain('No feedback yet.');
    expect(html).toContain('Use the feedback button in the toolbar to send the first one.');
    expect(html).not.toContain('<ul');
  });

  it('never renders an empty List', () => {
    const html = render(ENTRIES);

    expect(html).not.toMatch(/<ul[^>]*><\/ul>/);
    expect(rowTitles(html).length).toBeGreaterThan(0);
  });

  it('mounts the feedback toolbar item for this app on the empty inbox', () => {
    // `FeedbackInbox` runs `useState` for the status filter, so the direct call
    // goes through the same spy-backed react module the filter renders use —
    // otherwise the raw `useState` throws outside a component (the
    // meal-editor/meal-target pattern).
    const spy = jest.spyOn(ReactModule, 'useState');
    spy.mockImplementation(((initial: unknown) => [initial, () => initial]) as unknown as typeof ReactModule.useState);
    try {
      const el = FeedbackInbox({
        entries: [],
        settingsHref: SETTINGS_HREF,
        submitFeedbackAction: noopAction,
      }) as unknown as { props: { navTrailing: { props: { children: unknown } } } };

      // The gear joins this app's own toolbar item inside one fragment (the
      // meals-nav shape): feedback first, Settings trailing.
      type NavChild = { type?: unknown; props: { app?: unknown; label?: unknown; href?: unknown } };
      const kids = el.props.navTrailing.props.children as NavChild[];

      const feedback = kids.find((kid) => kid.type === FeedbackNavItem);
      expect(feedback?.props.app).toBe('feedback');

      const gear = kids[kids.length - 1];
      expect(gear?.props.label).toBe('Settings');
      expect(gear?.props.href).toBe(SETTINGS_HREF);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('FeedbackInbox rows', () => {
  it('renders a status pill and dropdown on every row', () => {
    const html = render(ENTRIES);

    expect(statusSelect(html, 'fb feat title')).toBeTruthy();
    expect(statusPill(html, 'fb feat title')).toEqual({
      class: 'ui-pill ui-pill--chip ui-pill--open',
      label: 'Open',
    });
    expect(statusPill(html, 'todos bug title')).toEqual({
      class: 'ui-pill ui-pill--chip ui-pill--in_progress',
      label: 'In Progress',
    });
    expect(statusPill(html, 'notes bug title')).toEqual({
      class: 'ui-pill ui-pill--chip ui-pill--done',
      label: 'Done',
    });
    expect(statusPill(html, 'fb feat old title')).toEqual({
      class: 'ui-pill ui-pill--chip ui-pill--wont_do',
      label: "Won't Do",
    });
  });

  it('names the dropdown for the entry, so a row is reachable by its title', () => {
    const html = render(ENTRIES);

    expect(statusSelect(html, 'fb feat title')).toBeTruthy();
    expect(statusSelect(html, 'notes bug title')).toBeTruthy();
  });
});

/**
 * The same inbox render under a preset filter. `useState` is answered off the
 * raw react module (the push-toggle/meal-editor pattern): the first hook is the
 * filter (`FeedbackInbox`'s own state), followed by each rendered row's two
 * (in-flight pick, failure message) — so handing the spy a preset only for the
 * first hook seeds the filter and the component code itself is exercised
 * untouched.
 */
const ReactModule = jest.requireActual<typeof import('react')>('react');

interface FoundSelect { value: unknown; onChange: (event: unknown) => void }
interface FoundRow { render: (props: Record<string, unknown>) => unknown; props: Record<string, unknown> }
interface El { type?: unknown; props?: Record<string, unknown> }

function isEl(node: unknown): node is El {
  return node != null && typeof node === 'object' && 'props' in (node as Record<string, unknown>);
}

/** Every row dropdown: the `Select` elements the rendered tree carries. */
function findSelects(node: unknown): FoundSelect[] {
  const found: FoundSelect[] = [];
  function walk(current: unknown): void {
    if (Array.isArray(current)) {
      for (const child of current) walk(child);
      return;
    }
    if (!isEl(current)) return;
    const { type, props } = current;
    if (
      type === Select &&
      props != null &&
      typeof props.onChange === 'function'
    ) {
      found.push({
        value: props.value as unknown,
        onChange: props.onChange as (event: unknown) => void,
      });
      return;
    }
    if (props != null) {
      for (const value of Object.values(props)) walk(value);
    }
  }
  walk(node);
  return found;
}

/**
 * Render one `FeedbackRow` element under the slot spy: hook calls land on slots
 * `set` by the caller, so successive renders of the same element read and write
 * the same hook values React would keep across renders.
 */
function renderRow(row: FoundRow, hookBase: number, spy: { setIndex(at: number): void }): unknown {
  spy.setIndex(hookBase);
  return row.render(row.props);
}

/** The `FeedbackRow` elements (unexpanded): detected by their distinctive props. */
function findFeedbackRowElements(node: unknown): FoundRow[] {
  const found: FoundRow[] = [];
  function walk(current: unknown): void {
    if (Array.isArray(current)) {
      for (const child of current) walk(child);
      return;
    }
    if (!isEl(current)) return;
    const { type, props } = current;
    if (typeof type === 'function' && props != null && 'setStatusAction' in props && 'entry' in props) {
      found.push({ render: type as (p: Record<string, unknown>) => unknown, props });
      return;
    }
    if (props != null) {
      for (const value of Object.values(props)) walk(value);
    }
  }
  walk(node);
  return found;
}

function walkText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(walkText).join('');
  if (isEl(node)) return walkText(node.props?.children as unknown);
  return '';
}

/** The failure strings the row renders via its `AlertBanner`. */
/** The failure strings the row renders via its `AlertBanner`. */
function collectBannerTexts(node: unknown): string[] {
  const found: string[] = [];
  function walk(current: unknown): void {
    if (Array.isArray(current)) {
      for (const child of current) walk(child);
      return;
    }
    if (!isEl(current)) {
      if (typeof current === 'string') found.push(current);
      return;
    }
    const { type, props } = current;
    if (type === AlertBanner) {
      found.push(walkText(props?.children as unknown));
      return;
    }
    // No component expansion here: callers pass already-rendered trees.
    // (`ListItem`/`Pill`/`Section` subtrees carry the banner through props.)
    if (props != null) {
      for (const value of Object.values(props)) walk(value);
    }
  }
  walk(node);
  return found;
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * One slot-store `useState` spy: hook call N answers slot N, so a test can place
 * a component's hooks at a chosen offset (`setIndex`) and re-render it against
 * the same values. `slot 0` is always pre-seeded with `first`.
 */
function slotSpy(first: unknown): { spy: jest.SpyInstance; setIndex(at: number): void } {
  const store: unknown[] = [first];
  let index = 0;
  const spy = jest.spyOn(ReactModule, 'useState');
  spy.mockImplementation(((initial: unknown) => {
    const at = index++;
    if (at >= store.length) {
      store[at] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    }
    const set = (next: unknown) => {
      store[at] = typeof next === 'function' ? (next as (prev: unknown) => unknown)(store[at]) : next;
    };
    return [store[at], set];
  }) as unknown as typeof ReactModule.useState);
  return { spy, setIndex: (at: number) => { index = at; } };
}

describe('FeedbackInbox filtering', () => {
  it('renders the All + per-status pill bar with All active by default', () => {
    const html = render(ENTRIES);

    const bar = html.slice(html.indexOf('ui-pill-group'), html.indexOf('ui-section'));
    expect(bar).toContain('>All</button>');
    expect(bar).toContain('>Open</button>');
    expect(bar).toContain('>In Progress</button>');
    expect(bar).toContain('>Done</button>');
    expect(bar).toContain('>Won&#x27;t Do</button>');
    const active = bar.match(/class="ui-pill ui-pill--filter ui-pill--button ui-pill--active"/g) ?? [];
    expect(active.length).toBe(1);
  });

  it('shows only the Done rows under the Done filter, same grouping and order', () => {
    const html = renderWithFilter(ENTRIES, 'done');

    expect(rowTitles(html)).toEqual(['notes bug title']);
    expect(rowSnippets(html)).toEqual(['notes bug']);
    expect(headings(html, 'h2')).toEqual(['Notes']);
    expect(headings(html, 'h3')).toEqual(['Bug report']);
    expect(statusPill(html, 'notes bug title')).toEqual({
      class: 'ui-pill ui-pill--chip ui-pill--done',
      label: 'Done',
    });
  });

  it('shows only the open rows under Open, grouped canonically', () => {
    const html = renderWithFilter(ENTRIES, 'open');

    expect(rowTitles(html)).toEqual([
      'notes feat title',
      'todos feat title',
      'fb feat title',
    ]);
    expect(headings(html, 'h2')).toEqual(['Notes', 'Todos', 'Feedback']);
    expect(headings(html, 'h3')).toEqual([
      'Feature request',
      'Feature request',
      'Feature request',
    ]);
  });

  it('hides groups with no visible rows instead of rendering empty sections', () => {
    const html = renderWithFilter(ENTRIES, 'done');

    expect(headings(html, 'h2')).toEqual(['Notes']);
    expect(html).not.toContain('Todos');
    expect(html).not.toContain('Feedback</h2>');
  });

  it('shows a filter-specific empty state when entries exist but none match', () => {
    const onlyOpen = [fb({ id: '1', app: 'notes', type: 'bug_report', title: 'still open', description: 'open', status: 'open' })];
    const html = renderWithFilter(onlyOpen, 'done');

    expect(html).toContain('No Done feedback.');
    expect(html).not.toContain('No feedback yet.');
    expect(html).not.toContain('<ul');
  });

  it('keeps the frozen empty state for a genuinely empty inbox under a filter', () => {
    const html = renderWithFilter([], 'wont_do');

    expect(html).toContain('No feedback yet.');
    expect(html).not.toContain('<ul');
  });

  it('routes the row dropdown through the status seam.', () => {
    const calls: Array<{ id: string; status: FeedbackDto['status'] }> = [];
    const wiredAction = async (
      id: string,
      status: FeedbackDto['status'],
    ): Promise<FeedbackSubmitResult> => {
      calls.push({ id, status });
      return { ok: true, id };
    };
    const { spy, setIndex } = slotSpy(null);
    try {
      setIndex(0);
      const el = FeedbackInbox({
        entries: [fb({ id: 'f1', app: 'notes', type: 'bug_report', title: 'wire me', description: 'w', status: 'open' })],
        settingsHref: SETTINGS_HREF,
        submitFeedbackAction: noopAction,
        setFeedbackStatusAction: wiredAction,
      });
      const rows = findFeedbackRowElements(el);
      expect(rows).toHaveLength(1);

      // The row's own hooks live past the inbox's filter hook (slot 0).
      setIndex(1);
      const selects = findSelects(rows[0]!.render(rows[0]!.props));
      expect(selects).toHaveLength(1);
      expect(selects[0]?.value).toBe('open');

      selects[0]?.onChange({ target: { value: 'done' } });
      expect(calls).toEqual([{ id: 'f1', status: 'done' }]);
    } finally {
      spy.mockRestore();
    }
  });

  it('renders the seam failure message in the row when a write fails.', async () => {
    const action = jest
      .fn(async (): Promise<FeedbackSubmitResult> => ({ ok: false, message: STATUS_FAILURE }));
    const { spy, setIndex } = slotSpy(null);
    try {
      setIndex(0);
      const el = FeedbackInbox({
        entries: [fb({ id: 'f1', app: 'notes', type: 'bug_report', title: 'fail me', description: 'w', status: 'open' })],
        settingsHref: SETTINGS_HREF,
        submitFeedbackAction: noopAction,
        setFeedbackStatusAction: action,
      });
      const rows = findFeedbackRowElements(el);
      expect(rows).toHaveLength(1);

      setIndex(1);
      const first = rows[0]!.render(rows[0]!.props);
      findSelects(first)[0]!.onChange({ target: { value: 'done' } });
      await flushMicrotasks();

      // Re-render the same row off the settled slots: the failure message the
      // seam documents is now rendered, and the dropdown falls back to the
      // server's status (the pill's value) instead of diverging from it.
      const second = renderRow(rows[0]!, 1, { setIndex });
      expect(collectBannerTexts(second)).toContain(STATUS_FAILURE);
      expect(findSelects(second)[0]!.value).toBe('open');
    } finally {
      spy.mockRestore();
    }
  });

  it('All shows every row exactly as the unfiltered inbox.', () => {
    const html = renderWithFilter(ENTRIES, null);
    expect(rowTitles(html)).toEqual([
      'notes feat title',
      'notes bug title',
      'todos feat title',
      'todos bug title',
      'fb feat title',
      'fb feat old title',
    ]);
  });
});

/**
 * The server-action seams the row dropdown and toolbar item call
 * (`SPEC-feedback-status` §6: action wiring lives in this inbox suite). The
 * action's own branches — revalidate on success, one message on failure, a
 * Next-internal error rethrown — are the subject.
 */
describe('setFeedbackStatusAction', () => {
  beforeEach(() => jest.clearAllMocks());

  it('writes the status, then revalidates /feedback, returning the id', async () => {
    mockedUpdateFeedbackStatus.mockResolvedValue({ id: 'f1', status: 'done' });

    const result = await setFeedbackStatusAction('f1', 'done');

    expect(mockedUpdateFeedbackStatus).toHaveBeenCalledWith('f1', 'done');
    expect(mockedRevalidatePath).toHaveBeenCalledWith('/feedback');
    expect(result).toEqual({ ok: true, id: 'f1' });
  });

  it('maps an upstream failure to the one user message, revalidating nothing', async () => {
    mockedUpdateFeedbackStatus.mockRejectedValue(new ApiError(500, 'API 500 on /api/feedback/f1'));

    const result = await setFeedbackStatusAction('f1', 'done');

    expect(result).toEqual({ ok: false, message: "Couldn't update status. Try again." });
    expect(mockedRevalidatePath).not.toHaveBeenCalled();
  });

  it('rethrows a Next-internal error instead of swallowing it into a message', async () => {
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT' });
    mockedUpdateFeedbackStatus.mockRejectedValue(redirect);

    await expect(setFeedbackStatusAction('f1', 'done')).rejects.toBe(redirect);
    expect(mockedRevalidatePath).not.toHaveBeenCalled();
  });
});

describe('submitFeedbackAction', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates the entry, revalidates /feedback, returning the id', async () => {
    mockedCreateFeedback.mockResolvedValue({ id: 'f2' });

    const result = await submitFeedbackAction({
      id: 'key',
      app: 'notes',
      type: 'bug_report',
      title: 't',
      description: 'd',
    });

    expect(mockedRevalidatePath).toHaveBeenCalledWith('/feedback');
    expect(result).toEqual({ ok: true, id: 'f2' });
  });

  it('maps an upstream failure to the one user message', async () => {
    mockedCreateFeedback.mockRejectedValue(new ApiError(400, 'API 400 on /api/feedback'));

    const result = await submitFeedbackAction({
      id: 'key',
      app: 'notes',
      type: 'bug_report',
      title: 't',
      description: 'd',
    });

    expect(result).toEqual({ ok: false, message: "Couldn't send feedback. Try again." });
  });
});