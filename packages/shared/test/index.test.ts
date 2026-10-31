import { FEEDBACK_DESCRIPTION_MAX, FEEDBACK_TITLE_MAX, TODO_REPEAT_DAYS, TODO_REPEATS } from '../src/index';
import * as barrel from '../src/index';

describe('todo repeat vocabulary', () => {
  it('includes the custom repeat', () => {
    expect(TODO_REPEATS).toContain('custom');
  });

  it('exposes the ISO weekday domain 1..7', () => {
    expect(TODO_REPEAT_DAYS).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('feedback title limit', () => {
  it('caps titles at 200 below the description max', () => {
    expect(FEEDBACK_TITLE_MAX).toBe(200);
    expect(FEEDBACK_TITLE_MAX).toBeLessThan(FEEDBACK_DESCRIPTION_MAX);
  });
});

/**
 * The barrel is imported by browser code (`apps/app` through `packages/ui`), so
 * anything it re-exports lands in the client graph. `resolveDbPath` pulls in
 * `node:path`, which is why it lives behind `@life/shared/node` instead.
 */
describe('browser-safe barrel', () => {
  it('does not export the Node-only resolveDbPath', () => {
    expect(Object.keys(barrel)).not.toContain('resolveDbPath');
  });
});
