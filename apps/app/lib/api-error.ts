/**
 * The BFF's typed upstream error. Kept free of `server-only`/Next imports so it
 * can be asserted from unit tests and reused by the pure composition helpers.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
