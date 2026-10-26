import { FOOD_NAME_MAX, SERVING_LABEL_MAX, PORTIONS_MAX, AMOUNT_MAX } from '@/lib/meal-api';
import { FOOD_NUTRITION } from '../fields';
import { FoodForm, type FoodFormBounds } from '../food-form';

export const dynamic = 'force-dynamic';

/**
 * The create form (`SPEC-food-catalog-ui` AC2): name, unit, the 27 hand-typed
 * per-100 facts and the starting measures, posted once as `servingGrams: 100`.
 * The bounds mirror the service `CreateFoodDto`; `lib/meal-api.ts` owns the
 * values (lesson 0016) and this page only passes them down.
 */
export default function NewFoodPage() {
  const bounds: FoodFormBounds = {
    nameMax: FOOD_NAME_MAX,
    labelMax: SERVING_LABEL_MAX,
    portionsMax: PORTIONS_MAX,
    amountMax: AMOUNT_MAX,
  };
  return <FoodForm food={null} nutrition={FOOD_NUTRITION} bounds={bounds} />;
}