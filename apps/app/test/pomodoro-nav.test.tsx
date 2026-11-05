import { renderToStaticMarkup } from 'react-dom/server';

import { FeedbackNavItem, SettingsLink } from '@life/ui';

import { PomodoroNav } from '@/app/pomodoro/pomodoro-nav';

function asArray(node: { props: { children: unknown } }): any[] {
  const kids = node.props.children;
  return Array.isArray(kids) ? kids : [kids];
}

describe('pomodoro toolbar nav', () => {
  it('renders the stats link, then the gear-last settings link', () => {
    const html = renderToStaticMarkup(<PomodoroNav />);

    expect(html).toContain('href="/pomodoro/stats"');
    expect(html).toContain('aria-label="Stats"');
    expect(html).toContain('href="/pomodoro/settings"');
    expect(html).toContain('aria-label="Settings"');
    expect(html.indexOf('aria-label="Settings"')).toBeGreaterThan(
      html.indexOf('aria-label="Stats"'),
    );
  });

  it('carries no feedback control — the Support row on /pomodoro/settings is its only door', () => {
    const kids = asArray(PomodoroNav() as unknown as { props: { children: unknown } });

    expect(kids.some((k) => k.type === FeedbackNavItem)).toBe(false);
    expect(kids).toHaveLength(2);
    expect(kids[0].props.label).toBe('Stats');
    expect(kids[1].type).toBe(SettingsLink);
    expect(kids[1].props.href).toBe('/pomodoro/settings');
  });
});
