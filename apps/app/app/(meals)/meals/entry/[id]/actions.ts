'use server';

import { revalidatePath } from 'next/cache';
import type { NutrientVector } from '@life/nutrition';
import {
  createMealEntry,
  createSavedMeal,
  estimatePhoto,
  updateMealEntry,
  type MealGroup,
  type PhotoEstimate,
  type SavedMeal,
} from '@/lib/meal-api';

/**
 * The review editor's server actions (`SPEC-meal-capture-ui`). The browser never
 * calls `meal-service` directly: every action here resolves a session and calls
 * through the server-only BFF client (`lib/meal-api.ts`), so the JWT and the
 * service URL stay server-side.
 */

/** The editor's route, revalidated after a write so the day view is fresh. */
function revalidateEditor(id: string) {
  revalidatePath(`/meals/entry/${id}`);
  revalidatePath('/meals');
}

/**
 * The ONE photo estimate call site. Reads the image plus the optional hint out
 * of the form and posts both through `lib/meal-api.ts`'s single
 * `POST /api/estimates/photo` path. A transport failure collapses to the same
 * explicit "could not read" answer as the model's own refusal, so the editor
 * has exactly one failure branch (open manual entry).
 */
export async function estimatePhotoAction(formData: FormData): Promise<PhotoEstimate> {
  const file = formData.get('image');
  const hintRaw = formData.get('hint');
  const hint = typeof hintRaw === 'string' && hintRaw.trim() !== '' ? hintRaw : undefined;
  if (!(file instanceof File) || file.size === 0) {
    return { readable: false, reason: 'no-image' };
  }
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    return await estimatePhoto(
      { base64: bytes.toString('base64'), mimeType: file.type || 'image/jpeg' },
      hint,
    );
  } catch {
    return { readable: false, reason: 'could-not-read' };
  }
}

/**
 * Persist the corrected item set. `id` null = the entry does not exist yet, so
 * each corrected item is created as its own entry; otherwise the first item's
 * corrected snapshot is what the entry persists (`PATCH /api/entries/:id`).
 */
export async function saveEntryAction(
  id: string | null,
  input: {
    date: string;
    mealGroup: MealGroup;
    expectedVersion: number;
    items: Array<{
      dish: string;
      foodId?: string | null;
      quantity: number;
      nutrients: NutrientVector;
    }>;
  },
): Promise<void> {
  const { date, mealGroup, expectedVersion, items } = input;
  if (id === null) {
    // A created entry needs a quantity alongside its snapshot (the service
    // rejects a quantity change without one), so both ride each per-item POST.
    for (const item of items) {
      await createMealEntry({
        date,
        mealGroup,
        // A catalog id wins; a bare item still logs under its dish name.
        foodId: item.foodId || item.dish,
        quantity: item.quantity,
        nutrients: item.nutrients,
      });
    }
    revalidatePath('/meals');
    return;
  }
  const [first] = items;
  if (!first) return;
  await updateMealEntry(id, {
    quantity: first.quantity,
    nutrients: first.nutrients,
    expectedVersion,
  });
  revalidateEditor(id);
}

/**
 * Freeze the current corrected item set as a saved meal
 * (`POST /api/saved-meals`) — the "correct once, re-log in one tap" snapshot.
 * The snapshots arrive as complete `@life/nutrition` vectors the editor
 * already confirmed; the service seals them verbatim.
 */
export async function saveAsMealAction(
  name: string,
  mealGroup: MealGroup,
  items: Array<{ foodId?: string; quantity: number; nutrients: NutrientVector }>,
): Promise<SavedMeal> {
  const saved = await createSavedMeal({
    name,
    mealGroup,
    items: items.map((item) => ({
      ...(item.foodId !== undefined ? { foodId: item.foodId } : {}),
      quantity: item.quantity,
      nutrients: item.nutrients,
    })),
  });
  revalidatePath('/meals/saved');
  return saved;
}
