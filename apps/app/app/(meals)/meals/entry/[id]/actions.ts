'use server';

import { revalidatePath } from 'next/cache';
import type { NutrientVector } from '@life/nutrition';
import {
  createMealEntry,
  createMealFood,
  createSavedMeal,
  estimatePhoto,
  listMealFoods,
  updateMealEntry,
  type MealFood,
  type MealGroup,
  type PhotoEstimate,
  type SavedMeal,
} from '@/lib/meal-api';
import { isPhotoBlob, photoMimeType } from '@/lib/photo-mime';

/**
 * The review editor's server actions (`SPEC-meal-capture-ui`). The browser never
 * calls `meal-service` directly: every action here resolves a session and calls
 * through the server-only BFF client (`lib/meal-api.ts`), so the JWT and the
 * service URL stay server-side.
 */

/**
 * One logged row as the editor confirmed it: the food's stored name (`dish`),
 * the catalog reference when the estimate resolved one (`foodId`), and the
 * effective vector (already scaled by `quantity`) with its servings multiplier.
 */
interface ConfirmedRow {
  dish: string;
  foodId?: string | null;
  quantity: number;
  nutrients: NutrientVector;
}

/**
 * The ONE photo estimate call site. Reads the image plus the optional hint out
 * of the form and posts both through `lib/meal-api.ts`'s single
 * `POST /api/estimates/photo` path. The service's own reason passes through
 * unchanged; a call that never reached it — network, 5xx, an unreadable file —
 * is `service-unavailable`, so the editor can tell "send a better photo" from
 * "retry later" (`SPEC-photo-identity.md § Failure reasons`).
 */
export async function estimatePhotoAction(formData: FormData): Promise<PhotoEstimate> {
  const file = formData.get('image');
  const hintRaw = formData.get('hint');
  const hint = typeof hintRaw === 'string' && hintRaw.trim() !== '' ? hintRaw : undefined;
  if (!isPhotoBlob(file) || file.size === 0) {
    // The door's own answer: which keys actually arrived, what each holds, and the
    // form's own type. `get('image')` null with other keys present means the part
    // was renamed in flight, not that the guard rejected its class.
    const entries = [...formData.entries()].map(
      ([key, value]) =>
        `${key}=${isPhotoBlob(value) ? `blob(size=${value.size},type="${value.type}")` : `${typeof value}(${String(value).slice(0, 40)})`}`,
    );
    console.error(
      `[photo] no usable file: image=${file === null ? 'null' : isPhotoBlob(file) ? `size=${file.size}` : typeof file} keys=[${entries.join(', ')}]`,
    );
    return { readable: false, reason: 'no-image' };
  }
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const mimeType = photoMimeType(bytes, file.type);
    // The upload's own fingerprint: the size the browser sent, what the signature
    // says the bytes are versus what the browser claimed, and enough leading hex to
    // name an unrecognised container (an iPhone HEIC is the expected surprise).
    console.info(
      `[photo] file size=${file.size} declared="${file.type}" resolved="${mimeType}" first16=${bytes.subarray(0, 16).toString('hex')}`,
    );
    const result = await estimatePhoto(
      { base64: bytes.toString('base64'), mimeType },
      hint,
    );
    console.info(`[photo] estimate result: ${result.readable ? `readable, ${result.items.length} item(s)` : `unreadable (${result.reason})`}`);
    return result;
  } catch {
    return { readable: false, reason: 'service-unavailable' };
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
    items: ConfirmedRow[];
  },
): Promise<void> {
  const { date, mealGroup, expectedVersion, items } = input;
  if (id === null) {
    // A Food row is created only here, at log time — never at estimate time
    // (`SPEC-meal-capture-grams § The log-time create path`).
    const catalog = await listMealFoods();
    const pendingCreates = new Map<string, Promise<string>>();
    for (const item of items) {
      await createMealEntry({
        date,
        mealGroup,
        foodId: await resolveFoodId(item, catalog, pendingCreates),
        quantity: item.quantity,
        nutrients: item.nutrients,
      });
    }
    revalidatePath('/meals');
    return;
  }
  // A correction to an already-logged entry stays entry-local: the PATCH writes
  // the snapshot only and never creates or updates a catalog food (locked
  // decision — a catalog food is written once, at creation).
  const [first] = items;
  if (!first) return;
  await updateMealEntry(id, {
    quantity: first.quantity,
    nutrients: first.nutrients,
    expectedVersion,
  });
  revalidateEditor(id);
}

/** The editor's route, revalidated after a write so the day view is fresh. */
function revalidateEditor(id: string) {
  revalidatePath(`/meals/entry/${id}`);
  revalidatePath('/meals');
}

/**
 * The comparison key for matching a logged name to the catalog: trim, collapse
 * internal whitespace, case-fold (`SPEC-meal-capture-grams § The normalized
 * name key`). The stored name keeps the user's exact spelling — the key exists
 * only for comparison, so `Chicken`/`chicken`/`chicken ` are one food and
 * `chicken`/`chicken breast` stay two.
 */
function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The vector the catalog stores: the confirmed effective vector un-scaled by
 * `quantity` (servings). The editor's `canSave` guarantees `quantity > 0`, so
 * this never divides by zero (`effective ÷ 0` would yield `NaN`/`Infinity`).
 */
function baseVector(effective: NutrientVector, quantity: number): NutrientVector {
  const out = {} as NutrientVector;
  for (const key of Object.keys(effective) as (keyof NutrientVector)[]) {
    out[key] = effective[key] / quantity;
  }
  return out;
}

/**
 * Resolve one confirmed row to its catalog id. An item carrying a `foodId`
 * reuses it — no new food, no USDA call. A `foodId: null` item is matched by
 * normalized key against the catalog; only a miss creates the food at
 * `servingGrams: 100`, and the id it returns is what the entry carries.
 *
 * `pendingCreates` keys in-flight creates by normalized key, so two rows of one
 * log that normalize the same produce one `Food` and two `Entry`s: the second
 * row joins the first's promise instead of creating a second food.
 */
async function resolveFoodId(
  row: ConfirmedRow,
  catalog: MealFood[],
  pendingCreates: Map<string, Promise<string>>,
): Promise<string> {
  if (row.foodId) return row.foodId;

  const key = nameKey(row.dish);
  const matched = catalog.find((food) => nameKey(food.name) === key);
  if (matched) return matched.id;

  const inFlight = pendingCreates.get(key);
  if (inFlight) return inFlight;

  const created = createMealFood({
    name: row.dish,
    servingGrams: 100,
    nutrients: baseVector(row.nutrients, row.quantity),
  }).then((food) => food.id);
  pendingCreates.set(key, created);
  return created;
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
