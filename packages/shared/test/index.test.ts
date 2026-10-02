import { TODO_REPEAT_DAYS, TODO_REPEATS } from '../src/index';

describe('todo repeat vocabulary', () => {
  it('includes the custom repeat', () => {
    expect(TODO_REPEATS).toContain('custom');
  });

  it('exposes the ISO weekday domain 1..7', () => {
    expect(TODO_REPEAT_DAYS).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
