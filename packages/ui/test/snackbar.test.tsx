import { act, fireEvent, render, screen } from '@testing-library/react';
import { Snackbar } from '../src/components/snackbar';
import { SnackbarProvider, useSnackbar } from '../src/components/snackbar-provider';

const EXIT_MS = 200;

describe('Snackbar', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function setup(props: Partial<Parameters<typeof Snackbar>[0]> = {}) {
    const onDismiss = jest.fn();
    render(<Snackbar message="Saved" duration={1000} onDismiss={onDismiss} {...props} />);
    return { onDismiss };
  }

  it('renders the message with role="status"', () => {
    setup();
    const status = screen.getByRole('status');
    expect(status.className.split(/\s+/)).toContain('ui-snackbar');
    expect(document.querySelector('.ui-snackbar__text')!.textContent).toBe('Saved');
  });

  it('calls onAction then leaves and calls onDismiss', () => {
    const onAction = jest.fn();
    const onDismiss = jest.fn();
    render(
      <Snackbar
        message="Saved"
        actionLabel="Undo"
        onAction={onAction}
        duration={1000}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').className).toMatch(/ui-snackbar--leaving/);
    act(() => {
      jest.advanceTimersByTime(EXIT_MS);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('auto-dismisses after the duration plus the exit window', () => {
    const { onDismiss } = setup();
    act(() => {
      jest.advanceTimersByTime(999);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(1);
    });
    act(() => {
      jest.advanceTimersByTime(EXIT_MS);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders the action through the Button atom, not a raw button', () => {
    setup({ actionLabel: 'Undo', onAction: jest.fn() });
    const action = screen.getByRole('button', { name: 'Undo' });
    expect(action.className.split(/\s+/)).toContain('ui-snackbar__action');
    expect(action.className.split(/\s+/)).toContain('ui-btn');
  });
});

describe('useSnackbar', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is a safe no-op outside a provider', () => {
    function Consumer() {
      const { showSnackbar } = useSnackbar();
      return <button onClick={() => showSnackbar({ message: 'noop' })}>go</button>;
    }
    render(<Consumer />);
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'go' }))).not.toThrow();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows a consumer-triggered snackbar and dismisses after the duration', () => {
    function Consumer() {
      const { showSnackbar } = useSnackbar();
      return (
        <button onClick={() => showSnackbar({ message: 'Task deleted', duration: 1000 })}>
          go
        </button>
      );
    }
    render(
      <SnackbarProvider>
        <Consumer />
      </SnackbarProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(screen.getByRole('status').textContent).toContain('Task deleted');
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    act(() => {
      jest.advanceTimersByTime(EXIT_MS);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
