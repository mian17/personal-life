import { render, screen } from '@testing-library/react';
import { Screen } from '../src/components/screen';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean);
}

const section = () => document.querySelector('.ui-screen')!;

describe('Screen', () => {
  it('names the section from its own hidden heading, so the IDREF cannot dangle', () => {
    render(
      <Screen label="Session setup">
        <span data-testid="body">one</span>
      </Screen>,
    );

    const heading = screen.getByRole('heading', { level: 2, name: 'Session setup' });
    expect(section().getAttribute('aria-labelledby')).toBe(heading.id);
    expect(heading.id).not.toBe('');
    expect(classesOf(heading)).toContain('sr-only');
    expect(section().contains(screen.getByTestId('body'))).toBe(true);
  });

  it('renders the heading level the page outline needs: an h2 under the shell title', () => {
    render(
      <Screen label="Session in progress">
        <span />
      </Screen>,
    );

    expect(screen.getByRole('heading', { level: 2 }).tagName).toBe('H2');
  });

  it('emits no name and no heading at all when the label is omitted', () => {
    render(
      <Screen>
        <span />
      </Screen>,
    );

    expect(section().hasAttribute('aria-labelledby')).toBe(false);
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('stays structure: no role, no tab stop, no live region', () => {
    render(
      <Screen label="Session setup">
        <span />
      </Screen>,
    );

    expect(section().hasAttribute('role')).toBe(false);
    expect(section().hasAttribute('tabindex')).toBe(false);
    expect(section().hasAttribute('aria-live')).toBe(false);
  });

  it('selects the stack column by default and the centred one on request', () => {
    const { unmount } = render(
      <Screen>
        <span />
      </Screen>,
    );
    expect(classesOf(section())).toContain('gap-[var(--s5)]');
    expect(classesOf(section())).not.toContain('text-center');
    unmount();

    render(
      <Screen layout="centred">
        <span />
      </Screen>,
    );
    expect(classesOf(section())).toContain('text-center');
    expect(classesOf(section())).toContain('gap-[var(--s6)]');
    expect(classesOf(section())).not.toContain('gap-[var(--s5)]');
  });
});
