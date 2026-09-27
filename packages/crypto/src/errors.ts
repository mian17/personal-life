/**
 * Typed failure for every crypto path: tamper, parse, version and key errors.
 * Messages describe *what* failed, never key material, plaintext or AAD contents.
 */
export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoError';
    Object.setPrototypeOf(this, CryptoError.prototype);
  }
}
