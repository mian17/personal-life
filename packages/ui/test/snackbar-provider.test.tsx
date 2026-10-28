import { act, fireEvent, render, screen } from '@testing-library/react';
import { SnackbarProvider, useSnackbar } from '../src/components/snackbar-provider';

const EXIT_MS = 200;

/** A consumer that enqueues one snackbar per click, the way an app surface does. */
function Trigger({
  label,
  message,
  duration,
}: Readonly<{ label: string; message: string; duration: number }>) {
  const { showSnackbar } = useSnackbar();
  return (
    <button type="button" onClick={() => showSnackbar({ message, duration })}>
      {label}
    </button>
  );
}

function renderProvider(message: string, duration: number) {
  render(
    <SnackbarProvider>
      <Trigger label="show" message={message} duration={duration} />
    </SnackbarProvider>,
  );
  return () => fireEvent.click(screen.getByRole('button', { name: 'show' }));
}

/** Let the exit window elapse, so a dismissed snackbar has unmounted. */
function passExitWindow() {
  act(() => {
    jest.advanceTimersByTime(EXIT_MS);
  });
}

describe('SnackbarProvider', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows nothing until a consumer enqueues a snackbar', () => {
    renderProvider('Task deleted', 1000);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('enqueues a consumer message and puts it on screen', () => {
    const show = renderProvider('Task deleted', 1000);
    show();

    expect(screen.getByRole('status').textContent).toContain('Task deleted');
  });

  it('auto-dismisses after the duration, then removes the snackbar', () => {
    const show = renderProvider('Task deleted', 1000);
    show();

    act(() => {
      jest.advanceTimersByTime(999);
    });
    expect(screen.getByRole('status').textContent).toContain('Task deleted');

    act(() => {
      jest.advanceTimersByTime(1);
    });
    passExitWindow();

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('replaces the visible snackbar when a second message arrives', () => {
    render(
      <SnackbarProvider>
        <Trigger label="show first" message="First" duration={1000} />
        <Trigger label="show second" message="Second" duration={1000} />
      </SnackbarProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'show first' }));
    fireEvent.click(screen.getByRole('button', { name: 'show second' }));

    const statuses = screen.getAllByRole('status');
    expect(statuses).toHaveLength(1);
    expect(statuses[0].textContent).toContain('Second');
  });

  it('hands the action to the consumer and dismisses the snackbar after it', () => {
    const onAction = jest.fn();

    function ActionTrigger() {
      const { showSnackbar } = useSnackbar();
      return (
        <button
          type="button"
          onClick={() =>
            showSnackbar({
              message: 'Task deleted',
              actionLabel: 'Undo',
              onAction,
              duration: 1000,
            })
          }
        >
          show
        </button>
      );
    }

    render(
      <SnackbarProvider>
        <ActionTrigger />
      </SnackbarProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'show' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(onAction).toHaveBeenCalledTimes(1);

    passExitWindow();

    expect(screen.queryByRole('status')).toBeNull();
  });
});
