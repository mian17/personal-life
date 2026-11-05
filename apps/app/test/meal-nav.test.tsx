import { renderToStaticMarkup } from 'react-dom/server';

import { SettingsLink } from '@life/ui';

import { MealsNav } from '@/app/meals-nav';

function asArray(node: { props: { children: unknown } }): any[] {
  const kids = node.props.children;
  return Array.isArray(kids) ? kids : [kids];
}

describe('meals toolbar nav', () => {
  it('is exactly two controls: the daily target, then the gear', () => {
    const html = renderToStaticMarkup(<MealsNav />);

    expect(html).toContain('href="/meals/target"');
    expect(html).toContain('aria-label="Daily target"');
    expect(html).toContain('href="/meals/settings"');
    expect(html).toContain('aria-label="Settings"');
    // The bar carries two controls, so every destination that left it is gone:
    // saved meals and foods are `/meals/settings` rows, feedback is its Support row.
    expect(html).not.toContain('href="/meals/saved"');
    expect(html).not.toContain('href="/meals/foods"');
    expect(html).not.toContain('aria-label="Send feedback"');
    // Target first, gear last, as the reference draws the pair.
    expect(html.indexOf('aria-label="Settings"')).toBeGreaterThan(
      html.indexOf('aria-label="Daily target"'),
    );
  });

  it('renders the gear through the shared SettingsLink, as the last control', () => {
    const kids = asArray(MealsNav() as unknown as { props: { children: unknown } });

    expect(kids).toHaveLength(2);
    const last = kids[kids.length - 1];
    expect(last.type).toBe(SettingsLink);
    expect(last.props.href).toBe('/meals/settings');
  });
});
