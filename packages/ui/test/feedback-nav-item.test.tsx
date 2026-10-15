import { act, fireEvent, render, screen } from '@testing-library/react';
import type { CreateFeedbackInput, FeedbackSubmitResult } from '@life/shared';
import { FeedbackNavItem } from '../src/components/feedback-nav-item';

// jsdom 20 has no `Crypto.randomUUID`; the browser supplies the real one.
let minted = 0;
(globalThis as unknown as { crypto: { randomUUID: () => string } }).crypto.randomUUID = () =>
  `00000000-0000-4000-8000-${String(++minted).padStart(12, '0')}`;

type DialogShim = {
  showModal(this: HTMLDialogElement): void;
  close(this: HTMLDialogElement): void;
};

const showModal = jest.fn(function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
});
const close = jest.fn(function (this: HTMLDialogElement) {
  this.removeAttribute('open');
});

beforeEach(() => {
  showModal.mockClear();
  close.mockClear();
  (HTMLDialogElement.prototype as unknown as DialogShim).showModal = showModal;
  (HTMLDialogElement.prototype as unknown as DialogShim).close = close;
});

function renderItem() {
  const onSubmit = jest.fn(
    async (_input: CreateFeedbackInput): Promise<FeedbackSubmitResult> => ({ ok: true, id: 'srv-1' }),
  );
  render(<FeedbackNavItem app="notes" onSubmit={onSubmit} />);
  return { onSubmit };
}

describe('FeedbackNavItem', () => {
  it('renders the frozen toolbar label, closed by default', () => {
    renderItem();

    const trigger = screen.getByRole('button', { name: 'Send feedback' });
    expect(trigger.getAttribute('aria-label')).toBe('Send feedback');
    expect(showModal).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')!.hasAttribute('open')).toBe(false);
  });

  it('opens the dialog from the toolbar item and closes it on a successful submit', async () => {
    const { onSubmit } = renderItem();

    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Send feedback');

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'a title' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'an idea' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    expect(onSubmit).toHaveBeenCalledWith({
      id: expect.any(String),
      app: 'notes',
      type: 'feature_request',
      title: 'a title',
      description: 'an idea',
    });
    expect(document.querySelector('dialog')!.hasAttribute('open')).toBe(false);
  });

  it('accepts a custom label without changing the block', () => {
    render(<FeedbackNavItem app="todos" onSubmit={jest.fn()} label="Tell us" />);
    expect(screen.getByRole('button', { name: 'Tell us' })).toBeTruthy();
  });
});
