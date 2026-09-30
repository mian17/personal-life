import { notFound } from 'next/navigation';

/** True when `error` is 404-shaped: a non-null object whose `status === 404`. */
export function isNotFoundStatus(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 404;
}

export interface LoadOrNotFoundOptions {
  /** Override the default 404 predicate. */
  isNotFound?: (error: unknown) => boolean;
}

/**
 * Await a loader and, if it throws a not-found error, call Next's `notFound()`;
 * otherwise rethrow. Server-only (Next control flow) — never import into a
 * client component.
 */
export async function loadOrNotFound<T>(
  load: () => Promise<T>,
  options?: LoadOrNotFoundOptions,
): Promise<T> {
  const isNotFound = options?.isNotFound ?? isNotFoundStatus;
  try {
    return await load();
  } catch (error) {
    if (isNotFound(error)) {
      notFound();
    }
    throw error;
  }
}
