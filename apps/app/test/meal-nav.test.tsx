import { renderToStaticMarkup } from 'react-dom/server';

import { MealsNav } from '@/app/meals-nav';

describe('meals toolbar nav', () => {
  it('links to the daily target and the gear-last settings page', () => {
    const html = renderToStaticMarkup(<MealsNav />);

    expect(html).toContain('href="/meals/target"');
    expect(html).toContain('aria-label="Daily target"');
    expect(html).toContain('href="/meals/settings"');
    expect(html).toContain('aria-label="Settings"');
    // Notes/todos put the gear last; meals matches.
    expect(html.indexOf('aria-label="Settings"')).toBeGreaterThan(
      html.indexOf('aria-label="Daily target"'),
    );
  });
});
