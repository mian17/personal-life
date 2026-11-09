import { SignJWT } from 'jose';

// `.mts` because only a file jest treats as ESM can reach an ESM-only package.
// jose is ESM-only (`"type": "module"`, no `main`); the same import from a `.ts`
// file fails with ERR_REQUIRE_ESM, because TypeScript emits `await import(x)`
// as `require(x)` under `module: commonjs` and jest's registry is CommonJS.
it('loads an ESM-only package', () => {
  expect(typeof SignJWT).toBe('function');
});
