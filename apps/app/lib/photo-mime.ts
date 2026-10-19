/**
 * The photo door's one honest answer to "what format are these bytes?".
 *
 * A `File` carries a `type` the browser chose, and on a phone that field is
 * often empty: the camera or the library hands over bytes it cannot name. Two
 * guesses have already shipped against that gap and both were wrong. Labelling
 * the bytes `image/jpeg` sends HEIC to the model as JPEG, which fails as
 * unreadable; sending the empty name fails the service's mime gate for the same
 * reason, blaming the photo for a label the client could not supply.
 *
 * Neither guess can be right without looking, so the file's own signature
 * decides. The browser's claim is only the fallback, for a format this table
 * does not know.
 */

const HEIF_BRANDS: Record<string, string> = {
  heic: 'image/heic',
  heix: 'image/heic',
  hevc: 'image/heic',
  hevx: 'image/heic',
  heim: 'image/heic',
  heis: 'image/heic',
  hevm: 'image/heic',
  hevs: 'image/heic',
  mif1: 'image/heif',
  msf1: 'image/heif',
  avif: 'image/avif',
};

/** A still image's MIME type from its magic bytes, or undefined when unrecognised. */
export function signatureMimeType(bytes: Buffer): string | undefined {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  // HEIC, HEIF and AVIF are all ISO base-media files: a `ftyp` box whose brand
  // names the variant. That brand is what the model has to be told.
  if (ascii(bytes, 4, 8) === 'ftyp') return HEIF_BRANDS[ascii(bytes, 8, 12)];
  return undefined;
}

/**
 * The MIME type to send for `bytes`, preferring what they are over what the
 * browser claimed. `declared` is the `File.type` the client supplied.
 */
export function photoMimeType(bytes: Buffer, declared: string): string {
  return signatureMimeType(bytes) ?? declared;
}

/**
 * Whether `value` is a photo the action can read.
 *
 * Not `instanceof File`: the action receives whatever Next rebuilt from the
 * multipart part, and `instanceof` compares class identity, not shape. A `Blob`
 * from the decoder, or a `File` from another realm, both carry the bytes — and
 * bytes plus a type is all this door ever needs. `null` (no file part at all)
 * and a string still fail, so `no-image` keeps its meaning.
 */
export function isPhotoBlob(value: unknown): value is Blob {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Blob>;
  return typeof candidate.arrayBuffer === 'function' && typeof candidate.size === 'number';
}

function startsWith(bytes: Buffer, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function ascii(bytes: Buffer, start: number, end: number): string {
  return bytes.subarray(start, end).toString('latin1');
}
