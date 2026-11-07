import { navActions } from '@life/app-kit';

/**
 * The Todos toolbar, shared by `/todos` and its lenses. Settings is its only control: the tags,
 * lists and trash destinations moved to `/todos/settings` rows, and feedback is that screen's
 * Support row.
 */
export function TodosNav() {
  return navActions('todos');
}
