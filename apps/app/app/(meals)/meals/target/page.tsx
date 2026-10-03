import { format } from '@life/nutrition';
import { ApiError } from '@/lib/api-error';
import { getMealTarget, type MealTarget } from '@/lib/meal-api';
import { getToday } from '@/lib/today';
import { TargetProfileForm } from './form';

export const dynamic = 'force-dynamic';

/**
 * The target onboarding page (`SPEC-target-onboarding`): the target row that
 * applies today, and the profile form that stores the next version. A missing
 * profile (target 404) is the first-run state, not an error page.
 *
 * The page is an editor screen: the frame — back + save — belongs to the form
 * (its Save needs the form's own `saving` state), and the day's derived-calorie
 * headline is passed down as the read-only `summary` the server computed here.
 * One `EditorChrome`, one save control, no app shell duplicated around it.
 */

/** A missing row is the empty state; any other failure is a real error. */
async function loadTarget(date: string): Promise<MealTarget | null> {
  try {
    return await getMealTarget(date);
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** The day's kcal headline plus its macro split, through `@life/nutrition`'s formatter. */
function targetSummary(target: MealTarget): string {
  const macros = [
    format('protein', target.proteinG),
    format('fat', target.fatG),
    format('carbohydrates', target.carbG),
  ].join(' · ');
  return `${format('calories', target.calories)} · ${macros}`;
}

export default async function TargetPage() {
  const today = await getToday();
  const target = await loadTarget(today);

  return (
    <TargetProfileForm
      initial={target}
      summary={target == null ? null : targetSummary(target)}
    />
  );
}
