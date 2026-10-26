import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { CryptoError } from './errors';

/** Field-envelope format marker: `enc.v1.<nonce-b64url>.<ct-b64url>`. */
export const ENC_PREFIX = 'enc.v1.';

/** 96-bit nonce, per NIST SP 800-38D random-nonce mode. */
export const NONCE_BYTES = 12;

/** AES-GCM default tag length in bytes. */
export const TAG_BYTES = 16;

/** AES-256 key length in bytes. */
export const KEY_BYTES = 32;

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Strict base64url (no padding) decode. Rejects any character outside the
 * base64url alphabet, padding, impossible lengths, and non-canonical encodings.
 */
export function decodeBase64Url(value: string, what: string): Buffer {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CryptoError(`invalid ${what}: expected a non-empty base64url string`);
  }
  if (!BASE64URL_RE.test(value) || value.length % 4 === 1) {
    throw new CryptoError(`invalid ${what}: not valid base64url`);
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) {
    throw new CryptoError(`invalid ${what}: non-canonical base64url`);
  }
  return decoded;
}

export function encodeBase64Url(value: Buffer): string {
  return value.toString('base64url');
}

function assertKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new CryptoError(`invalid key: expected ${KEY_BYTES} bytes`);
  }
}

/**
 * AES-256-GCM seal with an explicit nonce, returning `ciphertext || tag`.
 * Deterministic: the caller owns nonce uniqueness (production callers use
 * {@link encryptField}, which draws a fresh random nonce per encryption).
 */
export function seal(key: Buffer, nonce: Buffer, plaintext: Buffer, aad: Buffer): Buffer {
  assertKey(key);
  if (!Buffer.isBuffer(nonce) || nonce.length !== NONCE_BYTES) {
    throw new CryptoError(`invalid nonce: expected ${NONCE_BYTES} bytes`);
  }
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

/**
 * Parse `<prefix><nonce>.<ct>` (ct = ciphertext || tag). Strict: unknown
 * version, wrong part count, bad base64url, bad nonce length or short ct all
 * fail with {@link CryptoError}.
 */
export function splitSealed(
  sealed: string,
  prefix: string,
  label: string,
): { nonce: Buffer; body: Buffer; tag: Buffer } {
  if (typeof sealed !== 'string') {
    throw new CryptoError(`invalid ${label}: expected a string`);
  }
  if (!sealed.startsWith(prefix)) {
    throw new CryptoError(`invalid ${label}: unknown or missing version prefix`);
  }
  const parts = sealed.slice(prefix.length).split('.');
  if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
    throw new CryptoError(`invalid ${label}: expected exactly two base64url parts`);
  }
  const nonce = decodeBase64Url(parts[0], `${label} nonce`);
  if (nonce.length !== NONCE_BYTES) {
    throw new CryptoError(`invalid ${label}: nonce must be ${NONCE_BYTES} bytes`);
  }
  const combined = decodeBase64Url(parts[1], `${label} ciphertext`);
  if (combined.length < TAG_BYTES) {
    throw new CryptoError(`invalid ${label}: ciphertext shorter than the auth tag`);
  }
  return {
    nonce,
    body: combined.subarray(0, combined.length - TAG_BYTES),
    tag: combined.subarray(combined.length - TAG_BYTES),
  };
}

/**
 * AES-256-GCM open for a parsed envelope. Any authentication failure (tamper,
 * wrong key, AAD mismatch) is surfaced as {@link CryptoError}; never returns
 * partial plaintext.
 */
export function open(key: Buffer, envelope: string, aad: Buffer): Buffer {
  assertKey(key);
  const { nonce, body, tag } = splitSealed(envelope, ENC_PREFIX, 'envelope');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new CryptoError('field decryption failed: authentication or context mismatch');
  }
}

/**
 * Encrypt `plaintext` under `dek` into a self-describing envelope, binding it to
 * `aad`. A fresh 96-bit random nonce is drawn for every call.
 */
export function encryptField(dek: Buffer, plaintext: string, aad: string): string {
  assertKey(dek);
  if (typeof plaintext !== 'string') {
    throw new CryptoError('invalid plaintext: expected a string');
  }
  if (typeof aad !== 'string') {
    throw new CryptoError('invalid aad: expected a string');
  }
  const nonce = randomBytes(NONCE_BYTES);
  const combined = seal(dek, nonce, Buffer.from(plaintext, 'utf8'), Buffer.from(aad, 'utf8'));
  return `${ENC_PREFIX}${encodeBase64Url(nonce)}.${encodeBase64Url(combined)}`;
}

/**
 * Decrypt and authenticate a field envelope produced by {@link encryptField}.
 * The caller must reconstruct the identical `aad` string.
 */
export function decryptField(dek: Buffer, envelope: string, aad: string): string {
  assertKey(dek);
  if (typeof aad !== 'string') {
    throw new CryptoError('invalid aad: expected a string');
  }
  return open(dek, envelope, Buffer.from(aad, 'utf8')).toString('utf8');
}
