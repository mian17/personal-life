import { createElement, Fragment } from 'react';
import { SettingsLink } from '@life/ui';
import { navActions } from '../src/nav-actions';

/** The trailing controls a nav component passes ahead of the gear. */
function DailyTarget() {
  return createElement('a', { href: '/meals/target' }, 'Daily target');
}

describe('navActions', () => {
  it('returns the bare gear element when there is nothing ahead of it', () => {
    const actions = navActions('todos');
    expect(actions.type).toBe(SettingsLink);
    expect(actions.props.href).toBe('/todos/settings');
  });

  it('returns the leading controls first and the gear last', () => {
    const actions = navActions('meals', createElement(DailyTarget));
    expect(actions.type).toBe(Fragment);
    const [leading, gear] = actions.props.children;
    expect(leading.type).toBe(DailyTarget);
    expect(gear.type).toBe(SettingsLink);
    expect(gear.props.href).toBe('/meals/settings');
    expect(actions.props.children).toHaveLength(2);
  });

  it('derives the gear href from every app scope', () => {
    const scopes = ['notes', 'todos', 'meals', 'pomodoro', 'feedback'] as const;
    const hrefs = scopes.map((scope) => navActions(scope).props.href);
    expect(hrefs).toEqual([
      '/notes/settings',
      '/todos/settings',
      '/meals/settings',
      '/pomodoro/settings',
      '/feedback/settings',
    ]);
  });
});
