import { Pill, SettingsBlock, SettingsRow, SettingsShell } from '@life/ui';
import { submitFeedbackAction } from '@/app/feedback-actions';
import { getMealTodos } from '@/lib/meal-api';
import { MealTodoSwitch } from '@/app/meal-todo-toggle';

/**
 * Meals settings renders the shared settings shape — `SettingsShell` owns the Appearance,
 * Comfort and Support groups plus the closing prototype line — and adds the one group the app
 * owns: the destinations that used to ride the day view's toolbar as icons. The target row is
 * the same route as the toolbar's Daily target control, which is the app's one target screen.
 * Feedback is the shell's Support row, so it is not repeated here.
 *
 * The Todos row is the first-use enablement of `SPEC-todo-origin` (assumption 12): its switch
 * turns on the integration that creates and ticks the three daily meal tasks, so the user can
 * grant that from the screen instead of an operator running a CLI. Its state is read here, at
 * render, so the switch shows what the service holds rather than a hopeful default.
 */
export default async function MealsSettingsPage() {
  const todos = await getMealTodos();

  return (
    <SettingsShell title="Settings" backHref="/meals" app="meals" onSubmit={submitFeedbackAction}>
      <SettingsBlock title="Meals">
        <SettingsRow label="Daily target" href="/meals/target" control={<Pill>Edit</Pill>} />
        <SettingsRow label="Saved meals" href="/meals/saved" />
        <SettingsRow label="Foods" href="/meals/foods" />
        <SettingsRow
          label="Todos"
          description="Create and tick three daily tasks as you log meals."
          control={<MealTodoSwitch enabled={todos.enabled} />}
        />
      </SettingsBlock>
    </SettingsShell>
  );
}
