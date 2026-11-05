/**
 * Submission order, one item at a time rather than `Promise.all`
 * (`SPEC-batch-receiver.md` §5.2).
 *
 * Sequential is the contract, not an implementation detail: a per-item
 * `expectedVersion` check has to see the earlier items' effects, and a batch
 * repeating one id has to fail in a deterministic position.
 *
 * The recursion is a plain for-loop restated so the sequencing is structural:
 * each item starts only after the previous one settled. Depth is bounded by
 * `MAX_BATCH_ITEMS` (10), so it costs nothing.
 */
export async function runInSubmissionOrder<Item, Result>(
  items: readonly Item[],
  runItem: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = [];

  const runFrom = async (index: number): Promise<void> => {
    if (index === items.length) return;
    results.push(await runItem(items[index]));
    await runFrom(index + 1);
  };

  await runFrom(0);
  return results;
}
