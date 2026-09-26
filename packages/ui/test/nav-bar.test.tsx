import { render, screen } from '@testing-library/react';
import { NavBar } from '../src/components/nav-bar';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('NavBar', () => {
  it('renders a <nav> landmark with the ui-nav-bar class', () => {
    render(<NavBar />);
    const nav = screen.getByRole('navigation');
    expect(nav.tagName).toBe('NAV');
    expect(classesOf(nav)).toEqual(['ui-nav-bar']);
  });

  it('renders the trailing slot inside the ui-nav-bar__actions slot', () => {
    render(<NavBar trailing={<button type="button">Theme</button>} />);
    const actions = screen.getByRole('navigation').querySelector('.ui-nav-bar__actions');
    expect(actions).not.toBeNull();
    expect(actions!.contains(screen.getByRole('button', { name: 'Theme' }))).toBe(true);
  });

  it('renders the leading slot before the actions slot', () => {
    render(
      <NavBar
        leading={<span data-testid="leading">lead</span>}
        trailing={<span data-testid="trailing">trail</span>}
      />,
    );
    const nav = screen.getByRole('navigation');
    const leading = screen.getByTestId('leading');
    const actions = screen.getByTestId('trailing').parentElement!;
    expect(nav.firstElementChild).toBe(leading);
    expect(actions.classList.contains('ui-nav-bar__actions')).toBe(true);
  });

  it('omits the actions slot when there is no trailing content', () => {
    render(<NavBar />);
    expect(screen.getByRole('navigation').querySelector('.ui-nav-bar__actions')).toBeNull();
  });

  it('merges className instead of replacing it', () => {
    render(<NavBar className="legacy-hook" />);
    expect(classesOf(screen.getByRole('navigation'))).toEqual(['legacy-hook', 'ui-nav-bar']);
  });
});
