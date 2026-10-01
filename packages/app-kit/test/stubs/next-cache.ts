/**
 * Test stub for `next/cache` (mapped in package.json jest.moduleNameMapper).
 *
 * Production modules import the real `next/cache`; a unit test runs outside any
 * request scope, so `revalidatePath` is this module singleton jest function and a
 * suite asserts the calls Next would have been asked to revalidate.
 */

export const revalidatePath = jest.fn();
