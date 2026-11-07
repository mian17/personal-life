import { act, fireEvent, render, screen } from '@testing-library/react';
import { LoadMore } from '../src/components/load-more';

/** A promise whose settlement this test controls. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** The control's label text, which flips while a page is in flight. */
function labelOf(): string {
  return (screen.getByRole('button') as HTMLButtonElement).textContent ?? '';
}

describe('LoadMore', () => {
  it('renders a focusable button carrying the visible label', () => {
    render(<LoadMore onLoadMore={async () => {}} />);
    const button = screen.getByRole('button', { name: 'Load more' });

    expect(button.tagName).toBe('BUTTON');
    // The `Button` primitive's hook, not a div dressed as one.
    expect(button.classList.contains('ui-btn')).toBe(true);
    expect(button.getAttribute('type')).toBe('button');
    expect(button.hasAttribute('disabled')).toBe(false);
    button.focus();
    expect(document.activeElement).toBe(button);
  });

  it('accepts a different label for a different list', () => {
    render(<LoadMore onLoadMore={async () => {}} label="Load more foods" />);

    expect(screen.getByRole('button', { name: 'Load more foods' })).toBeTruthy();
  });

  it('disables itself while the page it asked for is pending', async () => {
    const page = deferred();
    const onLoadMore = jest.fn(() => page.promise);
    render(<LoadMore onLoadMore={onLoadMore} />);

    fireEvent.click(screen.getByRole('button'));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);
    expect(labelOf()).toBe('Loading');

    await act(async () => {
      page.resolve();
      await page.promise;
    });

    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false);
    expect(labelOf()).toBe('Load more');
  });

  it('re-enables after a rejection, so a failed page is not a wedged control', async () => {
    const page = deferred();
    const onLoadMore = jest.fn(() => page.promise);
    render(<LoadMore onLoadMore={onLoadMore} />);

    fireEvent.click(screen.getByRole('button'));
    await act(async () => {
      page.reject(new Error('upstream error'));
      // The rejection is the caller's to report; this control only re-arms.
      await page.promise.catch(() => undefined);
    });

    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false);
    expect(labelOf()).toBe('Load more');
  });

  it('fetches one page per press while idle', async () => {
    const onLoadMore = jest.fn(async () => {});
    render(<LoadMore onLoadMore={onLoadMore} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
      await onLoadMore.mock.results[0]?.value;
    });

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});
