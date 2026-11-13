import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('@/app/pomodoro/actions', () => ({ grantFocusReadAction: jest.fn() }));

import { FocusGrantToggle } from '@/app/focus-grant-toggle';
import { grantFocusReadAction } from '@/app/pomodoro/actions';

const mockedGrant = grantFocusReadAction as jest.MockedFunction<typeof grantFocusReadAction>;

beforeEach(() => {
  jest.resetAllMocks();
  mockedGrant.mockResolvedValue({ ok: true });
});

/**
 * The grant control has exactly two reachable states and one unknown. A `Switch` would
 * add an off position this feature does not have — there is no DELETE for a grant — so
 * these cases pin the two shapes: an action while absent, a read-out once granted that
 * says it cannot be switched off.
 */
describe('FocusGrantToggle', () => {
  const html = (state: 'granted' | 'missing' | 'unknown'): string =>
    renderToStaticMarkup(<FocusGrantToggle state={state} />);

  it('offers the Allow action when the service reports no grant', () => {
    expect(html('missing')).toContain('>Allow</button>');
  });

  it('renders a granted read-out, and says the grant cannot be switched off', () => {
    const markup = html('granted');

    expect(markup).toContain('Allowed. Focus can read your open todos');
    expect(markup).toContain('this cannot be switched off');
    // No control at all, and no `Switch` off position to press into a no-op.
    expect(markup).not.toContain('>Allow</button>');
    expect(markup).not.toContain('data-slot="switch"');
  });

  it('says the check failed rather than offering a press that may be redundant', () => {
    const markup = html('unknown');

    // `renderToStaticMarkup` HTML-escapes the apostrophe, so the frame is asserted, not the quote.
    expect(markup).toContain('check whether todo access is allowed. Reload to try again.');
    expect(markup).not.toContain('>Allow</button>');
  });

  it('is a @life/ui Button, never a raw element', () => {
    expect(html('missing')).toMatch(/<button[^>]*class="[^"]*btn/);
  });
});
