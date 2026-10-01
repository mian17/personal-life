/**
 * Test stub for `next/headers` (mapped in package.json jest.moduleNameMapper).
 *
 * Production modules import the real `next/headers`; a unit test runs outside any
 * request scope, so `cookies()` returns this module singleton whose `get` reads
 * the mutable `cookieStore` map (the singleton identity is what a suite asserts
 * against). Set `cookieState.throws` to force `cookies()` to reject the way an
 * out-of-request-scope read does.
 */

export const cookieStore: Record<string, string | undefined> = {};

export const cookieState = { throws: false };

export const cookieGet = jest.fn((name: string) => {
  const value = cookieStore[name];
  return value === undefined ? undefined : { name, value };
});

export async function cookies() {
  if (cookieState.throws) {
    throw new Error('cookies() was called outside a request scope');
  }
  return { get: cookieGet };
}
