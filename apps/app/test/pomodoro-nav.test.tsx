import { renderToStaticMarkup } from 'react-dom/server';

import { FeedbackNavItem } from '@life/ui';

import { PomodoroNav } from '@/app/pomodoro/pomodoro-nav';

function asArray(node: { props: { children: unknown } }): any[] {
  const kids = node.props.children;
  return Array.isArray(kids) ? kids : [kids];
}

describe('pomodoro toolbar nav', () => {
  it('renders the feedback item then the gear-last settings link', () => {
    const html = renderToStaticMarkup(<PomodoroNav />);

    expect(html).toContain('aria-label="Send feedback"');
    expect(html).toContain('href="/pomodoro/settings"');
    expect(html).toContain('aria-label="Settings"');
    expect(html.indexOf('aria-label="Settings"')).toBeGreaterThan(
      html.indexOf('aria-label="Send feedback"'),
    );
  });

  it('files its feedback under pomodoro', () => {
    const kids = asArray(PomodoroNav() as unknown as { props: { children: unknown } });

    const feedback = kids.filter((k) => k.type === FeedbackNavItem);
    expect(feedback).toHaveLength(1);
    expect(feedback[0].props.app).toBe('pomodoro');

    // Same trailing order as `/todos`: the gear is the last nav item.
    expect(kids[kids.length - 1].props.label).toBe('Settings');
    expect(kids.indexOf(feedback[0])).toBe(kids.length - 2);
  });
});
