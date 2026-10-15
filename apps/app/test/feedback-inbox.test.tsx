import type { CreateFeedbackInput, FeedbackDto, FeedbackSubmitResult } from '@life/shared';
import { FeedbackNavItem } from '@life/ui';
import { renderToStaticMarkup } from 'react-dom/server';
import { FeedbackInbox } from '../app/feedback-inbox';

const noopAction = async (_input: CreateFeedbackInput): Promise<FeedbackSubmitResult> => ({
  ok: true,
  id: 'x',
});

function fb(
  overrides: Partial<FeedbackDto> & Pick<FeedbackDto, 'id' | 'app' | 'type' | 'title' | 'description'>,
) {
  return { createdAt: '2026-10-03T00:00:00.000Z', ...overrides } satisfies FeedbackDto;
}

function headings(html: string, level: 'h2' | 'h3'): string[] {
  return [...html.matchAll(new RegExp(`<${level} class="ui-section__heading">([^<]*)</${level}>`, 'g'))].map(
    (m) => m[1],
  );
}

function rowTitles(html: string): string[] {
  return [...html.matchAll(/ui-list-item__title">([^<]*)</g)].map((m) => m[1]);
}

function rowSnippets(html: string): string[] {
  return [...html.matchAll(/ui-list-item__snippet">([^<]*)</g)].map((m) => m[1]);
}

function render(entries: FeedbackDto[]): string {
  return renderToStaticMarkup(
    <FeedbackInbox entries={entries} submitFeedbackAction={noopAction} />,
  );
}

// Newest-first as feedback-service returns them; encounter order is the
// newest-first order the inbox must preserve inside every bucket.
const ENTRIES: FeedbackDto[] = [
  fb({ id: '1', app: 'feedback', type: 'feature_request', title: 'fb feat title', description: 'fb feat new' }),
  fb({ id: '2', app: 'todos', type: 'bug_report', title: 'todos bug title', description: 'todos bug' }),
  fb({ id: '3', app: 'notes', type: 'bug_report', title: 'notes bug title', description: 'notes bug' }),
  fb({ id: '4', app: 'feedback', type: 'feature_request', title: 'fb feat old title', description: 'fb feat old' }),
  fb({ id: '5', app: 'todos', type: 'feature_request', title: 'todos feat title', description: 'todos feat' }),
  fb({ id: '6', app: 'notes', type: 'feature_request', title: 'notes feat title', description: 'notes feat' }),
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
      fb({ id: '1', app: 'zeta', type: 'question', title: 'zt', description: 'z' }),
      fb({ id: '2', app: 'notes', type: 'enhancement', title: 'nt', description: 'n' }),
      fb({ id: '3', app: 'alpha', type: 'bug_report', title: 'at', description: 'a' }),
      fb({ id: '4', app: 'notes', type: 'zzz', title: 'n2t', description: 'n2' }),
    ]);

    expect(headings(html, 'h2')).toEqual(['Notes', 'alpha', 'zeta']);
    expect(headings(html, 'h3')).toEqual(['Enhancement', 'zzz', 'Bug report', 'question']);
  });

  it('falls back to the raw id for an unknown app or type', () => {
    const html = render([
      fb({ id: '1', app: 'analytics', type: 'question', title: 'at', description: 'x' }),
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
    const el = FeedbackInbox({
      entries: [],
      submitFeedbackAction: noopAction,
    }) as unknown as { props: { navTrailing: any } };

    expect(el.props.navTrailing.type).toBe(FeedbackNavItem);
    expect(el.props.navTrailing.props.app).toBe('feedback');
  });
});