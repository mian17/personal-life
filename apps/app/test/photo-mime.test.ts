import { isPhotoBlob, photoMimeType, signatureMimeType } from '../lib/photo-mime';

/** Bytes as a camera hands them over: signature first, filler after. */
const withSignature = (...bytes: number[]): Buffer =>
  Buffer.concat([Buffer.from(bytes), Buffer.alloc(16)]);

describe('signatureMimeType', () => {
  it.each([
    ['JPEG', [0xff, 0xd8, 0xff, 0xe0], 'image/jpeg'],
    ['PNG', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a], 'image/png'],
    ['GIF', [0x47, 0x49, 0x46, 0x38, 0x39], 'image/gif'],
  ])('names %s from its magic bytes', (_name, bytes, expected) => {
    expect(signatureMimeType(withSignature(...bytes))).toBe(expected);
  });

  it('names WebP from its RIFF container', () => {
    const bytes = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('WEBPVP8 '),
    ]);
    expect(signatureMimeType(bytes)).toBe('image/webp');
  });

  it('names the HEIF family from its ftyp brand', () => {
    const heic = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from('ftypheic'),
      Buffer.alloc(8),
    ]);
    expect(signatureMimeType(heic)).toBe('image/heic');

    const avif = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x1c]),
      Buffer.from('ftypavif'),
      Buffer.alloc(8),
    ]);
    expect(signatureMimeType(avif)).toBe('image/avif');
  });

  it('answers undefined for bytes it does not know, never a guess', () => {
    expect(signatureMimeType(Buffer.from('not an image at all'))).toBeUndefined();
    expect(signatureMimeType(Buffer.alloc(0))).toBeUndefined();
  });
});

describe('isPhotoBlob', () => {
  it('accepts a File', () => {
    expect(isPhotoBlob(new File(['x'], 'a.jpg', { type: 'image/jpeg' }))).toBe(true);
  });

  it('accepts a bare Blob, which is what the action decoder can rebuild', () => {
    // The guard this replaces was `instanceof File`, and the action received
    // something it rejected — bytes plus a type is all the door needs.
    expect(isPhotoBlob(new Blob(['x'], { type: 'image/jpeg' }))).toBe(true);
  });

  it('rejects the empty form values, so no-image keeps its meaning', () => {
    expect(isPhotoBlob(null)).toBe(false);
    expect(isPhotoBlob(undefined)).toBe(false);
    expect(isPhotoBlob('a string field')).toBe(false);
    expect(isPhotoBlob({ not: 'a blob' })).toBe(false);
  });
});

describe('photoMimeType', () => {
  it("prefers the bytes over the browser's claim", () => {
    // A mislabelled file still gets the truth: the model must be told what arrived.
    expect(photoMimeType(withSignature(0xff, 0xd8, 0xff), 'application/octet-stream')).toBe(
      'image/jpeg',
    );
  });

  it('falls back to the declared type for a format this table does not know', () => {
    expect(photoMimeType(Buffer.from('unknown'), 'image/tiff')).toBe('image/tiff');
  });

  it('keeps an unnamed unknown file unnamed, so the failure can name the photo', () => {
    expect(photoMimeType(Buffer.from('unknown'), '')).toBe('');
  });
});
