import type { FormEvent } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConfirmButton } from '../src/components/confirm-button';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
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
});
