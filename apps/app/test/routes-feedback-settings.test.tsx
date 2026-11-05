import { SettingsShell } from '@life/ui';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('@/app/feedback-actions', () => ({ submitFeedbackAction: jest.fn() }));

import { submitFeedbackAction } from '@/app/feedback-actions';
import FeedbackSettingsPage from '@/app/feedback/settings/page';

/** React children normalized to an array (single child or list). */
function childList(node: any): any[] {
  const kids = node?.props?.children;
  if (kids == null) return [];
  return Array.isArray(kids) ? kids : [kids];
}

describe('/feedback/settings page wiring', () => {
  it('composes one SettingsShell titled Settings, backed to /feedback, wired to feedback feedback', () => {
    const page = FeedbackSettingsPage();

    expect(page.type).toBe(SettingsShell);
    expect(page.props.title).toBe('Settings');
    expect(page.props.backHref).toBe('/feedback');
    expect(page.props.app).toBe('feedback');
    expect(page.props.onSubmit).toBe(submitFeedbackAction);
  });

  it('passes no app-specific children: the shell draws the whole shape', () => {
    expect(childList(FeedbackSettingsPage())).toHaveLength(0);
  });

  it('renders the Appearance group as one pressed segment, with no Theme row', () => {
    const html = renderToStaticMarkup(FeedbackSettingsPage());
    const segment = html.match(/role="group" aria-label="Appearance"[^>]*/)?.[0] ?? '';

    expect(segment).not.toBe('');
    expect(html).not.toContain('System, light, or dark.');
  });

  it('renders the three-state Light/Dark/System appearance control', () => {
    const html = renderToStaticMarkup(FeedbackSettingsPage());

    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Appearance"');
    for (const label of ['Light', 'Dark', 'System']) {
      expect(html).toContain(`>${label}</button>`);
    }
    // Server render is the System choice, and the mount read moves it once stored.
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it('lays the appearance segment into the settings row: full width, no trough chrome', () => {
    const html = renderToStaticMarkup(FeedbackSettingsPage());
    const segment = html.match(/role="group" aria-label="Appearance"[^>]*/)?.[0] ?? '';

    expect(segment).toContain('w-full');
    expect(segment).not.toContain('bg-surface-sunken');
  });

  it('renders the frozen copy and a back affordance targeting /feedback', () => {
    const html = renderToStaticMarkup(FeedbackSettingsPage());

    expect(html).toContain('Settings');
    expect(html).toContain('Reduce motion');
    expect(html).toContain(
      'Follows the system setting. Turn it on in iOS Settings › Accessibility.',
    );
    expect(html).toContain('Send feedback');
    expect(html).toContain('Tell us what got in the way.');
    expect(html).toContain('Personal Life · prototype');
    expect(html).toContain('href="/feedback"');
  });
});
