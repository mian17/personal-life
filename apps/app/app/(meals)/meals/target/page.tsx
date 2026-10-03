import { format } from '@life/nutrition';
import { Card, PageShell, PageTitle, StatusText } from '@life/ui';
import { ApiError } from '@/lib/api-error';
import { getMealTarget, type MealTarget } from '@/lib/meal-api';
import { getToday } from '@/lib/today';
import { TargetProfileForm } from './form';

export const dynamic = 'force-dynamic';

/**
 * The target onboarding page (`SPEC-target-onboarding`): the target row that
 * applies today, and the profile form that stores the next version. A missing
 * profile (target 404) is the first-run state, not an error page.
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
    <PageShell>
      <PageTitle>Daily target</PageTitle>
      <Card>
        {target == null ? (
          <StatusText>No target set yet — add your profile below.</StatusText>
        ) : (
          <StatusText>{targetSummary(target)}</StatusText>
        )}
      </Card>
      <TargetProfileForm initial={target} />
    </PageShell>
  );
}
