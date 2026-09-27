import { createDecipheriv, createCipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { CryptoError } from './errors';
import {
  KEY_BYTES,
  NONCE_BYTES,
  TAG_BYTES,
  decodeBase64Url,
  encodeBase64Url,
} from './envelope';

/** Wrapped-DEK format marker: `kw.v1.<nonce-b64url>.<ct-b64url>`. */
export const KW_PREFIX = 'kw.v1.';

/** HKDF `info` domain separator: distinguishes DEK wrapping from any other use. */
const KEK_INFO = 'life/dek-wrap/v1';

const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function assertMasterKey(masterKey: Buffer): void {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== KEY_BYTES) {
    throw new CryptoError(`invalid master key: expected ${KEY_BYTES} bytes`);
  }
}

function assertDek(dek: Buffer): void {
  if (!Buffer.isBuffer(dek) || dek.length !== KEY_BYTES) {
    throw new CryptoError(`invalid dek: expected ${KEY_BYTES} bytes`);
  }
}

/**
 * KEK = HKDF-SHA256(masterKey, salt = '', info = 'life/dek-wrap/v1', 32B).
 * The KEK is only ever used to wrap/unwrap DEKs; content keys never touch it.
 */
export function deriveKek(masterKey: Buffer): Buffer {
  assertMasterKey(masterKey);
  return Buffer.from(
    hkdfSync('sha256', masterKey, Buffer.alloc(0), Buffer.from(KEK_INFO, 'utf8'), KEY_BYTES),
  );
}

/** Generate a fresh 256-bit data-encryption key. */
export function generateDek(): Buffer {
  return randomBytes(KEY_BYTES);
}

/** Wrap a DEK under a KEK derived from `masterKey`; returns `kw.v1.<nonce>.<ct||tag>`. */
export function wrapDek(dek: Buffer, masterKey: Buffer): string {
  assertDek(dek);
  const kek = deriveKek(masterKey);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', kek, nonce);
  const body = Buffer.concat([cipher.update(dek), cipher.final(), cipher.getAuthTag()]);
  return `${KW_PREFIX}${encodeBase64Url(nonce)}.${encodeBase64Url(body)}`;
}

function parseWrappedKey(wrapped: string): { nonce: Buffer; body: Buffer; tag: Buffer } {
  if (typeof wrapped !== 'string') {
    throw new CryptoError('invalid wrapped key: expected a string');
  }
  if (!wrapped.startsWith(KW_PREFIX)) {
    throw new CryptoError('invalid wrapped key: unknown or missing version prefix');
  }
  const parts = wrapped.slice(KW_PREFIX.length).split('.');
  if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
    throw new CryptoError('invalid wrapped key: expected exactly two base64url parts');
  }
  const nonce = decodeBase64Url(parts[0], 'wrapped key nonce');
  if (nonce.length !== NONCE_BYTES) {
    throw new CryptoError(`invalid wrapped key: nonce must be ${NONCE_BYTES} bytes`);
  }
  const combined = decodeBase64Url(parts[1], 'wrapped key ciphertext');
  if (combined.length < TAG_BYTES) {
    throw new CryptoError('invalid wrapped key: ciphertext shorter than the auth tag');
  }
  return {
    nonce,
    body: combined.subarray(0, combined.length - TAG_BYTES),
    tag: combined.subarray(combined.length - TAG_BYTES),
  };
}

/** Unwrap a DEK produced by {@link wrapDek}. Fails closed on any tamper/wrong-key. */
export function unwrapDek(wrapped: string, masterKey: Buffer): Buffer {
  const kek = deriveKek(masterKey);
  const { nonce, body, tag } = parseWrappedKey(wrapped);
  try {
    const decipher = createDecipheriv('aes-256-gcm', kek, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new CryptoError('dek unwrap failed: authentication or master-key mismatch');
  }
}

/**
 * Re-wrap a DEK under a new master key. Content ciphertexts are untouched; only
 * the `kw.v1` envelope changes and the underlying DEK bytes are preserved.
 */
export function rewrapDek(wrapped: string, oldMaster: Buffer, newMaster: Buffer): string {
  const dek = unwrapDek(wrapped, oldMaster);
  return wrapDek(dek, newMaster);
}

/**
 * Load a base64-encoded 256-bit master key from an environment variable.
 * Missing, non-base64 or wrong-length values fail closed with a message that
 * never contains key material.
 */
export function loadMasterKeyFromEnv(envName: string): Buffer {
  if (typeof envName !== 'string' || envName.length === 0) {
    throw new CryptoError('invalid environment variable name');
  }
  const raw = process.env[envName];
  if (raw === undefined || raw.length === 0) {
    throw new CryptoError(`missing master key: environment variable ${envName} is not set`);
  }
  if (!BASE64_RE.test(raw)) {
    throw new CryptoError(`invalid master key: environment variable ${envName} is not base64`);
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new CryptoError(
      `invalid master key: environment variable ${envName} must decode to ${KEY_BYTES} bytes`,
    );
  }
  return key;
}
