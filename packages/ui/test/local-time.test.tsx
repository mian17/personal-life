import { render } from '@testing-library/react';
import { LocalTime } from '../src/components/local-time';

// jsdom resolves `react-dom/server` to the browser build, which expects browser
// globals (MessageChannel/TextEncoder). The Node build has the same API and is
// used here for a true pre-effect server render. `require` (unlike `import`) is
// not hoisted, so it stays below the imports.
const { renderToStaticMarkup } = require('react-dom/server.node') as typeof import('react-dom/server');

const ISO = '2026-09-27T12:34:56.000Z';

function localized(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

describe('LocalTime', () => {
  it('renders empty content before effects run, keeping the dateTime attribute', () => {
    const html = renderToStaticMarkup(<LocalTime dateTime={ISO} />);
    expect(html).toMatch(new RegExp(`datetime="${ISO}"`, 'i'));
    expect(html).toMatch(/<time[^>]*><\/time>/);
  });

  it('renders a <time dateTime> element', () => {
    const { container } = render(<LocalTime dateTime={ISO} />);
    const time = container.querySelector('time');
    expect(time).not.toBeNull();
    expect(time?.tagName).toBe('TIME');
    expect(time?.getAttribute('datetime')).toBe(ISO);
  });

  it('fills with the localized date after mount', () => {
    const { container } = render(<LocalTime dateTime={ISO} />);
    expect(container.querySelector('time')?.textContent).toBe(localized(ISO));
  });

  it('re-localizes when dateTime changes', () => {
    const next = '2025-01-02T03:04:05.000Z';
    const { container, rerender } = render(<LocalTime dateTime={ISO} />);
    rerender(<LocalTime dateTime={next} />);
    expect(container.querySelector('time')?.textContent).toBe(localized(next));
  });

  it('merges className instead of replacing it', () => {
    const { container } = render(<LocalTime dateTime={ISO} className="legacy-hook" />);
    expect(container.querySelector('time')?.className).toContain('legacy-hook');
  });
});
