/**
 * Test stub for `next/navigation` (mapped in package.json jest.moduleNameMapper).
 *
 * Production modules import the real `next/navigation`; jsdom has no router
 * context, so `useRouter` returns this module singleton whose methods are jest
 * functions (the singleton identity is what a suite asserts against), and
 * `notFound` throws the way Next's control-flow signal does.
 */

export const routerStub = {
  replace: jest.fn(),
  push: jest.fn(),
  refresh: jest.fn(),
};

export function useRouter() {
  return routerStub;
}

export const notFound = jest.fn((): never => {
  throw new Error('NEXT_NOT_FOUND');
});
