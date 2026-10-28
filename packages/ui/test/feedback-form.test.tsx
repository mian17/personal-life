import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { CreateFeedbackInput, FeedbackSubmitResult } from '@life/shared';
import { FeedbackForm } from '../src/components/feedback-form';
import type { FeedbackFormProps } from '../src/components/feedback-form';

// jsdom 20 does not implement `Crypto.randomUUID`; production uses the native
// browser one (the block is untouched). Deterministic ids make the idempotency
// assertions exact.
let minted = 0;
(globalThis as unknown as { crypto: { randomUUID: () => string } }).crypto.randomUUID = () =>
  `00000000-0000-4000-8000-${String(++minted).padStart(12, '0')}`;

function renderForm(props: Partial<FeedbackFormProps> = {}) {
  const onOpenChange = jest.fn();
  const onSubmit = jest.fn(
    async (_input: CreateFeedbackInput): Promise<FeedbackSubmitResult> => ({ ok: true, id: 'srv-1' }),
  );
  render(
    <FeedbackForm open onOpenChange={onOpenChange} app="notes" onSubmit={onSubmit} {...props} />,
  );
  return { onOpenChange, onSubmit };
}

/** Owns `open` state so a test can close and re-open the dialog. */
function Harness({ onSubmit }: { onSubmit: FeedbackFormProps['onSubmit'] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open feedback
      </button>
      <FeedbackForm open={open} onOpenChange={setOpen} app="notes" onSubmit={onSubmit} />
    </>
  );
}

const titleInput = () =>
  screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement;
const textarea = () => screen.getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement;
const typeGroup = () => screen.getByRole('group', { name: 'Feedback type' });
const send = () => screen.getByRole('button', { name: 'Send' });

async function submitForm() {
  await act(async () => {
    fireEvent.click(send());
  });
}

describe('FeedbackForm', () => {
  it('opens with the frozen title and closes through onOpenChange', () => {
    const { onOpenChange } = renderForm();

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Send feedback');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('stays closed while open is false', () => {
    renderForm({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the three type pills with aria-pressed, first selected', () => {
    renderForm();

    const pills = within(typeGroup()).getAllByRole('button');
    expect(pills.map((pill) => pill.textContent)).toEqual([
      'Feature request',
      'Enhancement',
      'Bug report',
    ]);
    expect(pills.map((pill) => pill.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
    ]);

    fireEvent.click(pills[2]);
    expect(pills.map((pill) => pill.getAttribute('aria-pressed'))).toEqual([
      'false',
      'false',
      'true',
    ]);
  });

  it('sends no request for a blank title, shows the error and focuses the field', async () => {
    const { onSubmit, onOpenChange } = renderForm();
    fireEvent.change(titleInput(), { target: { value: '   ' } });
    fireEvent.change(textarea(), { target: { value: 'a description' } });

    expect((send() as HTMLButtonElement).disabled).toBe(false);
    await submitForm();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Title is required.');
    expect(titleInput().getAttribute('aria-invalid')).toBe('true');
    expect(textarea().getAttribute('aria-invalid')).toBeNull();
    expect(document.activeElement).toBe(titleInput());
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('with a title but a blank description, blocks with the description error and focuses it', async () => {
    const { onSubmit, onOpenChange } = renderForm();
    fireEvent.change(titleInput(), { target: { value: 'a title' } });
    fireEvent.change(textarea(), { target: { value: '   ' } });

    await submitForm();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Description is required.');
    expect(textarea().getAttribute('aria-invalid')).toBe('true');
    expect(titleInput().getAttribute('aria-invalid')).toBeNull();
    expect(document.activeElement).toBe(textarea());
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('clears aria-invalid from both fields after a corrected valid submit', async () => {
    const { onSubmit } = renderForm();

    await submitForm();
    expect(screen.getByRole('alert').textContent).toBe('Title is required.');
    expect(titleInput().getAttribute('aria-invalid')).toBe('true');

    fireEvent.change(titleInput(), { target: { value: 'a title' } });
    fireEvent.change(textarea(), { target: { value: 'a description' } });
    await submitForm();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(titleInput().getAttribute('aria-invalid')).toBeNull();
    expect(textarea().getAttribute('aria-invalid')).toBeNull();
  });

  it('submits the trimmed title and description with the exact app, type and idempotency key, then closes', async () => {
    const { onSubmit, onOpenChange } = renderForm({ app: 'todos' });
    fireEvent.click(within(typeGroup()).getByRole('button', { name: 'Bug report' }));
    fireEvent.change(titleInput(), { target: { value: '  dark mode  ' } });
    fireEvent.change(textarea(), { target: { value: '  dark mode please  ' } });

    await submitForm();

    expect(onSubmit).toHaveBeenCalledWith({
      id: expect.any(String),
      app: 'todos',
      type: 'bug_report',
      title: 'dark mode',
      description: 'dark mode please',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps the dialog open on a server failure and reuses the same id on retry', async () => {
    const onSubmit = jest.fn(
      async (_input: CreateFeedbackInput): Promise<FeedbackSubmitResult> => ({
        ok: false,
        message: "Couldn't send feedback. Try again.",
      }),
    );
    const { onOpenChange } = renderForm({ onSubmit });
    fireEvent.change(titleInput(), { target: { value: 'a title' } });
    fireEvent.change(textarea(), { target: { value: 'a bug' } });

    await submitForm();

    expect(screen.getByRole('alert').textContent).toBe("Couldn't send feedback. Try again.");
    expect(onOpenChange).not.toHaveBeenCalled();

    await submitForm();

    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1][0].id).toBe(onSubmit.mock.calls[0][0].id);
  });

  it('surfaces a rejected submit in the same banner and stays open', async () => {
    const onSubmit = jest.fn(async (): Promise<FeedbackSubmitResult> => {
      throw new Error('Network down.');
    });
    renderForm({ onSubmit });
    fireEvent.change(titleInput(), { target: { value: 'a title' } });
    fireEvent.change(textarea(), { target: { value: 'a bug' } });

    await submitForm();

    expect(screen.getByRole('alert').textContent).toBe('Network down.');
    expect((send() as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables the submit button while pending and labels it Sending…', async () => {
    let resolve!: (result: FeedbackSubmitResult) => void;
    const onSubmit = jest.fn(
      (_input: CreateFeedbackInput) =>
        new Promise<FeedbackSubmitResult>((r) => {
          resolve = r;
        }),
    );
    const { onOpenChange } = renderForm({ onSubmit });
    fireEvent.change(titleInput(), { target: { value: 'a title' } });
    fireEvent.change(textarea(), { target: { value: 'a bug' } });

    await submitForm();

    const pending = screen.getByRole('button', { name: 'Sending…' }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);

    await act(async () => {
      resolve({ ok: true, id: 'srv-1' });
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('mints a fresh id per open and resets the form copy', async () => {
    const onSubmit = jest.fn(
      async (_input: CreateFeedbackInput): Promise<FeedbackSubmitResult> => ({ ok: true, id: 'srv-1' }),
    );
    render(<Harness onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open feedback' }));
    fireEvent.change(titleInput(), { target: { value: 'first title' } });
    fireEvent.change(textarea(), { target: { value: 'first' } });
    await submitForm();
    expect(onSubmit).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Open feedback' }));
    expect(titleInput().value).toBe('');
    expect(textarea().value).toBe('');
    expect(
      within(typeGroup())
        .getAllByRole('button')
        .map((pill) => pill.getAttribute('aria-pressed')),
    ).toEqual(['true', 'false', 'false']);

    fireEvent.change(titleInput(), { target: { value: 'second title' } });
    fireEvent.change(textarea(), { target: { value: 'second' } });
    await submitForm();

    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1][0].id).not.toBe(onSubmit.mock.calls[0][0].id);
  });

  it('accepts overridden copy without changing the frozen defaults', () => {
    renderForm({ title: 'Custom', submitLabel: 'Send it' });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Custom');
    expect(screen.getByRole('button', { name: 'Send it' })).toBeTruthy();
  });

  it('renders visible labels bound to their controls with placeholders and required markers', () => {
    renderForm();

    const titleLabel = titleInput().labels?.[0] as HTMLLabelElement;
    const descriptionLabel = textarea().labels?.[0] as HTMLLabelElement;

    expect(titleLabel).toBeTruthy();
    expect(descriptionLabel).toBeTruthy();
    expect(titleLabel.getAttribute('for')).toBe(titleInput().id);
    expect(titleLabel.getAttribute('for')).not.toBe('');
    expect(descriptionLabel.getAttribute('for')).toBe(textarea().id);
    expect(descriptionLabel.getAttribute('for')).not.toBe('');

    expect(titleLabel.textContent).toContain('Title');
    expect(descriptionLabel.textContent).toContain('Description');

    expect(titleInput().placeholder).toBe('Short summary of your feedback');
    expect(textarea().placeholder).toBe('What happened, and what did you expect?');

    // The hooks lead the class list; the utilities that now carry the retired
    // `.ui-field-label--strong` colour and weight follow them.
    expect([titleLabel.classList[0], titleLabel.classList[1]]).toEqual([
      'ui-field-label',
      'ui-field-label--strong',
    ]);
    expect([descriptionLabel.classList[0], descriptionLabel.classList[1]]).toEqual([
      'ui-field-label',
      'ui-field-label--strong',
    ]);

    const markers = document.querySelectorAll('.ui-field-label__required');
    expect(markers).toHaveLength(2);
    markers.forEach((marker) => expect(marker.getAttribute('aria-hidden')).toBe('true'));

    expect(screen.getByRole('textbox', { name: 'Title' })).toBe(titleInput());
    expect(screen.getByRole('textbox', { name: 'Description' })).toBe(textarea());
  });
});
