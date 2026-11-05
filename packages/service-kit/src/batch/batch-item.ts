/**
 * Submission order, as a sequential loop rather than `Promise.all`
 * (`SPEC-batch-receiver.md` §5.2).
 *
 * Sequential is the contract, not an implementation detail: a per-item
 * `expectedVersion` check has to see the earlier items' effects, and a batch
 * repeating one id has to fail in a deterministic position.
 */
export async function runInSubmissionOrder<Item, Result>(
  items: readonly Item[],
  runItem: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = [];
  for (const item of items) {
    results.push(await runItem(item));
  }
  return results;
}
