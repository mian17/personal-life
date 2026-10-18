import { loadOrNotFound } from '@life/app-kit';
import { AMOUNT_MAX, FOOD_NAME_MAX, PORTIONS_MAX, SERVING_LABEL_MAX, getMealFood } from '@/lib/meal-api';
import { FOOD_NUTRITION } from '../fields';
import { FoodForm, type FoodFormBounds } from '../food-form';

export const dynamic = 'force-dynamic';

/**
 * The edit/delete form for one catalog food (`SPEC-food-catalog-ui` AC4/AC5).
 * The unit renders read-only (chosen once), facts open pre-filled with the
 * stored values, and deleting is the soft delete behind the form's
 * `ConfirmButton` — past entries never rewrite.
 */
export default async function EditFoodPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const food = await loadOrNotFound(() => getMealFood(id));

  const bounds: FoodFormBounds = {
    nameMax: FOOD_NAME_MAX,
    labelMax: SERVING_LABEL_MAX,
    portionsMax: PORTIONS_MAX,
    amountMax: AMOUNT_MAX,
  };
  return <FoodForm food={food} nutrition={FOOD_NUTRITION} bounds={bounds} />;
}