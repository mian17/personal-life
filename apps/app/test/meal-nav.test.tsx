import { renderToStaticMarkup } from 'react-dom/server';

import { FeedbackNavItem, SettingsLink } from '@life/ui';

import { MealsNav } from '@/app/meals-nav';

function asArray(node: { props: { children: unknown } }): any[] {
  const kids = node.props.children;
  return Array.isArray(kids) ? kids : [kids];
}

describe('meals toolbar nav', () => {
  it('links to the daily target and the gear-last settings page', () => {
    const html = renderToStaticMarkup(<MealsNav />);

    expect(html).toContain('href="/meals/target"');
    expect(html).toContain('aria-label="Daily target"');
    expect(html).toContain('href="/meals/saved"');
    expect(html).toContain('aria-label="Saved meals"');
    expect(html).toContain('href="/meals/settings"');
    expect(html).toContain('aria-label="Settings"');
    // Notes/todos put the gear last; meals matches.
    expect(html.indexOf('aria-label="Settings"')).toBeGreaterThan(
      html.indexOf('aria-label="Saved meals"'),
    );
    // Saved meals sits between the daily target and the gear.
    expect(html.indexOf('aria-label="Saved meals"')).toBeGreaterThan(
      html.indexOf('aria-label="Daily target"'),
    );
    // The shared feedback item renders between Saved meals and the gear.
    expect(html).toContain('aria-label="Send feedback"');
    expect(html.indexOf('aria-label="Send feedback"')).toBeGreaterThan(
      html.indexOf('aria-label="Saved meals"'),
    );
    expect(html.indexOf('aria-label="Settings"')).toBeGreaterThan(
      html.indexOf('aria-label="Send feedback"'),
    );
  });

  it('places the feedback item for this app before the Settings link', () => {
    const kids = asArray(MealsNav() as unknown as { props: { children: unknown } });

    const feedback = kids.filter((k) => k.type === FeedbackNavItem);
    expect(feedback).toHaveLength(1);
    expect(feedback[0].props.app).toBe('meals');

    // Settings stays the trailing nav item, feedback immediately before it.
    const last = kids[kids.length - 1];
    expect(last.type).toBe(SettingsLink);
    expect(last.props.href).toBe('/meals/settings');
    expect(kids.indexOf(feedback[0])).toBe(kids.length - 2);
  });
});
