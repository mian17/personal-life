import { DataSource, EntityManager } from 'typeorm';
import { CryptoError, unwrapDek, wrapDek } from '@life/crypto';

/**
 * `rotate-master-key` core (`SPEC-notes-backfill` Sibling script). Re-wraps every
 * `user_keys.wrappedDek` under a new master key and bumps `kekVersion`.
 *
 * The content columns are never read and never written: only the four `user_keys`
 * columns are touched, so a rotation cannot corrupt or re-encrypt note data. The
 * underlying DEK bytes are preserved byte-for-byte (asserted by test 6).
 *
 * Idempotence is per-row: a row already wrapped under the NEW key fails the
 * old-key unwrap, so it is reported `skipped` (never corrupted). Any OTHER
 * unwrap failure — tamper, wrong old key, malformed envelope — aborts with
 * {@link RotationRowError} and a non-zero exit.
 */

export interface RotationReport {
  rotated: number;
  skipped: number;
  /** Always `0` on a returned report; a genuine failure throws instead. */
  errors: number;
}

export class RotationRowError extends Error {
  constructor(
    readonly sub: string,
    readonly cause: unknown,
  ) {
    super(
      `rotation failed for user_keys sub ${sub}: ${
        cause instanceof Error ? cause.message : 'unknown error'
      }`,
    );
    this.name = 'RotationRowError';
  }
}

/** `true` when `wrapped` opens under `key` — i.e. it is already wrapped that way. */
function opensUnder(wrapped: string, key: Buffer): boolean {
  try {
    unwrapDek(wrapped, key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Re-wrap every registered DEK from `oldMaster` to `newMaster`, in one
 * transaction so a genuine failure never leaves the table half-rotated.
 */
export async function rotateMasterKeys(
  ds: DataSource,
  oldMaster: Buffer,
  newMaster: Buffer,
): Promise<RotationReport> {
  const rows = (await ds.query(
    'SELECT "sub", "wrappedDek", "kekVersion" FROM "user_keys" ORDER BY "sub" ASC',
  )) as Array<{ sub: string; wrappedDek: string; kekVersion: number }>;

  let rotated = 0;
  let skipped = 0;

  await ds.transaction(async (tm: EntityManager) => {
    for (const row of rows) {
      let dek: Buffer;
      try {
        dek = unwrapDek(row.wrappedDek, oldMaster);
      } catch (err) {
        if (err instanceof CryptoError && opensUnder(row.wrappedDek, newMaster)) {
          // Already rotated by a previous run: leave it exactly as-is.
          skipped += 1;
          continue;
        }
        throw new RotationRowError(row.sub, err);
      }
      await tm.query('UPDATE "user_keys" SET "wrappedDek" = ?, "kekVersion" = ? WHERE "sub" = ?', [
        wrapDek(dek, newMaster),
        row.kekVersion + 1,
        row.sub,
      ]);
      rotated += 1;
    }
  });

  return { rotated, skipped, errors: 0 };
}

/** One line both the script and any caller print (counts only). */
export function formatRotationReport(report: RotationReport): string {
  return `rotate-master-key: rotated=${report.rotated} skipped=${report.skipped} errors=${report.errors}`;
}
