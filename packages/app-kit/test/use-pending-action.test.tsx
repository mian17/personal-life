import { act, renderHook } from '@testing-library/react';
import { usePendingAction } from '../src/use-pending-action';

/**
 * The contract is one write per intent. Each case here fails on a distinct way to lose it:
 * a flag that never clears leaves the control dead, and a check that reads the rendered
 * `pending` instead of a synchronous ref lets the second tap through.
 */
describe('usePendingAction', () => {
  it('sets pending while the action runs and clears it after', async () => {
    const { result } = renderHook(() => usePendingAction());
    let release: () => void = () => {};
    const started = jest.fn();

    let running: Promise<void> = Promise.resolve();
    act(() => {
      running = result.current[1](
        () =>
          new Promise<void>((resolve) => {
            started();
            release = resolve;
          }),
      );
    });

    expect(started).toHaveBeenCalledTimes(1);
    expect(result.current[0]).toBe(true);

    await act(async () => {
      release();
      await running;
    });

    expect(result.current[0]).toBe(false);
  });

  it('refuses re-entry while pending: the second call never invokes its action', async () => {
    const { result } = renderHook(() => usePendingAction());
    const action = jest.fn(() => new Promise<void>(() => {}));

    act(() => {
      void result.current[1](action);
    });
    act(() => {
      void result.current[1](action);
    });

    expect(action).toHaveBeenCalledTimes(1);
  });

  it('clears pending when the action rejects and propagates the rejection', async () => {
    const { result } = renderHook(() => usePendingAction());
    const failure = new Error('write failed');

    await act(async () => {
      await expect(result.current[1](() => Promise.reject(failure))).rejects.toBe(failure);
    });

    expect(result.current[0]).toBe(false);
  });

  it('runs again once the previous action has settled', async () => {
    const { result } = renderHook(() => usePendingAction());
    const action = jest.fn(() => Promise.resolve());

    await act(async () => {
      await result.current[1](action);
    });
    await act(async () => {
      await result.current[1](action);
    });

    expect(action).toHaveBeenCalledTimes(2);
  });

  it('keeps run stable across renders', () => {
    const { result, rerender } = renderHook(() => usePendingAction());
    const first = result.current[1];

    rerender();

    expect(result.current[1]).toBe(first);
  });
});
