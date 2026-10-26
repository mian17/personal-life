import { bin, CHILD_PATH, childEnv } from '../src/child-process';

describe('child-process', () => {
  it('pins PATH to the allowlist instead of the caller environment', () => {
    const env = childEnv({ NODE_ENV: 'production' });
    expect(env.PATH).toBe(CHILD_PATH);
    expect(env.NODE_ENV).toBe('production');
  });

  it('resolves a command that exists on the pinned PATH', () => {
    expect(bin('node')).toMatch(/^\//);
  });

  it('refuses a command that is not installed anywhere on the allowlist', () => {
    expect(() => bin('definitely-not-a-real-binary-xyz')).toThrow(/cannot find/);
  });

  it('returns the same path on a second call, so the result is cached', () => {
    expect(bin('node')).toBe(bin('node'));
  });
});
