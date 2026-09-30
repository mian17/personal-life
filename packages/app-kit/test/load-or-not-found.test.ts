import { isNotFoundStatus, loadOrNotFound } from '../src/load-or-not-found';
import { notFound } from './stubs/next-navigation';

describe('isNotFoundStatus', () => {
  it('recognises only non-null objects whose status is 404', () => {
    expect(isNotFoundStatus({ status: 404 })).toBe(true);
    expect(isNotFoundStatus(Object.assign(new Error('gone'), { status: 404 }))).toBe(true);
    expect(isNotFoundStatus({ status: 500 })).toBe(false);
    expect(isNotFoundStatus(new Error('gone'))).toBe(false);
    expect(isNotFoundStatus(null)).toBe(false);
    expect(isNotFoundStatus(404)).toBe(false);
  });
});

describe('loadOrNotFound', () => {
  beforeEach(() => {
    notFound.mockClear();
  });

  it('passes a loaded value through', async () => {
    await expect(loadOrNotFound(async () => 'ok')).resolves.toBe('ok');
    expect(notFound).not.toHaveBeenCalled();
  });

  it('calls notFound for a 404-shaped error', async () => {
    const error = Object.assign(new Error('missing'), { status: 404 });
    await expect(loadOrNotFound(async () => Promise.reject(error))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it('rethrows any other error untouched', async () => {
    const error = new Error('boom');
    await expect(loadOrNotFound(async () => Promise.reject(error))).rejects.toBe(error);
    expect(notFound).not.toHaveBeenCalled();
  });

  it('honours a custom isNotFound predicate', async () => {
    const coded = Object.assign(new Error('gone'), { code: 404 });
    await expect(
      loadOrNotFound(async () => Promise.reject(coded), {
        isNotFound: (error) => (error as { code?: number }).code === 404,
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it('rethrows when the custom predicate declines a default-shaped 404', async () => {
    const error = Object.assign(new Error('missing'), { status: 404 });
    await expect(
      loadOrNotFound(async () => Promise.reject(error), { isNotFound: () => false }),
    ).rejects.toBe(error);
    expect(notFound).not.toHaveBeenCalled();
  });
});
