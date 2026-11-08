import type { FormEvent } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfirmButton } from '../src/components/confirm-button';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

/**
 * Resolves a submission the test itself controls, then lets React retire it.
 *
 * An action left in flight holds React's pending state open past the test that started it,
 * and a later test's own settle is then never reported — the release test below would fail
 * on the tests above it rather than on the code.
 */
async function settleSubmission(settlements: ReadonlyArray<() => void>): Promise<void> {
  await act(async () => {
    settlements.forEach((settle) => settle());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('ConfirmButton', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders a submit-type button through the Button atom', () => {
    render(<ConfirmButton message="Sure?">Delete</ConfirmButton>);
    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('submit');
    expect(button.classList.contains('ui-btn')).toBe(true);
  });

  it('merges className and passes variant/size through to Button', () => {
    render(
      <ConfirmButton message="Sure?" variant="danger" size="default" className="trash-delete">
        Delete
      </ConfirmButton>,
    );
    const classes = classesOf(screen.getByRole('button', { name: 'Delete' }));
    expect(classes).toContain('trash-delete');
    expect(classes).toContain('ui-btn--danger');
    expect(classes).toContain('ui-btn--default');
  });

  it('submits the form when the user confirms', () => {
    const onSubmit = jest.fn((event: FormEvent) => event.preventDefault());
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <form onSubmit={onSubmit}>
        <ConfirmButton message="Delete?">Delete</ConfirmButton>
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(window.confirm).toHaveBeenCalledWith('Delete?');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('cancels submission (preventDefault) when the user dismisses the confirm', () => {
    const onSubmit = jest.fn((event: FormEvent) => event.preventDefault());
    jest.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <form onSubmit={onSubmit}>
        <ConfirmButton message="Delete?">Delete</ConfirmButton>
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(window.confirm).toHaveBeenCalledWith('Delete?');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a dismissal fires neither the form submit nor the consumer onClick', () => {
    const onSubmit = jest.fn((event: FormEvent) => event.preventDefault());
    const onClick = jest.fn();
    jest.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <form onSubmit={onSubmit}>
        <ConfirmButton message="Delete?" onClick={onClick}>
          Delete
        </ConfirmButton>
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(window.confirm).toHaveBeenCalledWith('Delete?');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('a second tap while the onClick write is pending fires it once, and disables the button', async () => {
    const onClick = jest.fn(() => new Promise<void>(() => {}));
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    render(<ConfirmButton message="Delete?" onClick={onClick}>Delete</ConfirmButton>);
    const button = screen.getByRole('button', { name: 'Delete' });

    // Both taps land before React renders the disabled state — the only shape a
    // `disabled` attribute cannot catch, and the one the ref guard exists for.
    act(() => {
      button.click();
      button.click();
    });

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('is disabled while a form action of its own form is in flight', async () => {
    const settlements: Array<() => void> = [];
    const action = jest.fn(() => new Promise<void>((resolve) => settlements.push(() => resolve())));
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <form action={action}>
        <ConfirmButton message="Delete?">Delete</ConfirmButton>
      </form>,
    );
    const button = screen.getByRole('button', { name: 'Delete' });

    await act(async () => {
      fireEvent.click(button);
    });

    expect(action).toHaveBeenCalledTimes(1);
    expect(button.hasAttribute('disabled')).toBe(true);

    await settleSubmission(settlements);
  });

  it('submits a form action once when two taps land in the same frame', async () => {
    const settlements: Array<() => void> = [];
    const action = jest.fn(() => new Promise<void>((resolve) => settlements.push(() => resolve())));
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <form action={action}>
        <ConfirmButton message="Delete?">Delete</ConfirmButton>
      </form>,
    );
    const button = screen.getByRole('button', { name: 'Delete' });

    // There is no onClick to await here, and `useFormStatus` reports the submission a
    // render later — the click itself is the only thing that can shut this window.
    await act(async () => {
      button.click();
      button.click();
    });

    expect(action).toHaveBeenCalledTimes(1);
    expect(button.hasAttribute('disabled')).toBe(true);

    await settleSubmission(settlements);
  });

  it('releases the form latch once the submission settles, so a later delete still runs', async () => {
    const settlements: Array<() => void> = [];
    const action = jest.fn(() => new Promise<void>((resolve) => settlements.push(() => resolve())));
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <form action={action}>
        <ConfirmButton message="Delete?">Delete</ConfirmButton>
      </form>,
    );
    const button = screen.getByRole('button', { name: 'Delete' });

    await act(async () => {
      button.click();
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(button.hasAttribute('disabled')).toBe(true);

    await act(async () => {
      settlements[0]();
    });
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));

    await act(async () => {
      button.click();
    });
    expect(action).toHaveBeenCalledTimes(2);

    await settleSubmission(settlements);
  });

  it('a dismissed confirm arms nothing: no submit, no latch, the button stays live', () => {
    const action = jest.fn(() => new Promise<void>(() => {}));
    jest.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <form action={action}>
        <ConfirmButton message="Delete?">Delete</ConfirmButton>
      </form>,
    );
    const button = screen.getByRole('button', { name: 'Delete' });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(action).not.toHaveBeenCalled();
    expect(button.hasAttribute('disabled')).toBe(false);
    // A latch would have refused the second tap instead of asking again.
    expect(window.confirm).toHaveBeenCalledTimes(2);
  });

  it('respects a caller-supplied disabled', () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <ConfirmButton message="Delete?" disabled>
        Delete
      </ConfirmButton>,
    );

    expect(screen.getByRole('button', { name: 'Delete' }).hasAttribute('disabled')).toBe(true);
  });
});
