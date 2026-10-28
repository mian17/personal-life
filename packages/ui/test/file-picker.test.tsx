import { fireEvent, render, screen } from '@testing-library/react';
import { FilePicker } from '../src/components/file-picker';

function pickFile(name = 'cover.png') {
  const input = screen.getByLabelText('Cover photo');
  const file = new File(['x'], name, { type: 'image/png' });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

describe('FilePicker', () => {
  it('renders a file input with the forwarded label as its accessible name', () => {
    render(<FilePicker label="Cover photo" />);
    const input = screen.getByLabelText('Cover photo');
    expect(input.tagName).toBe('INPUT');
    expect(input.getAttribute('type')).toBe('file');
    // Lesson 0014: the accessible name and the visible text are one string.
    expect(screen.getByText('Cover photo').classList.contains('ui-file-picker__label')).toBe(true);
  });

  it('defaults accept to image/* and forwards an override', () => {
    const { rerender } = render(<FilePicker label="Cover photo" />);
    expect(screen.getByLabelText('Cover photo').getAttribute('accept')).toBe('image/*');

    rerender(<FilePicker label="Cover photo" accept="application/pdf" />);
    expect(screen.getByLabelText('Cover photo').getAttribute('accept')).toBe('application/pdf');
  });

  it('forwards the capture hint and other input attributes', () => {
    render(<FilePicker label="Cover photo" name="photo" capture="environment" multiple />);
    const input = screen.getByLabelText('Cover photo');
    expect(input.getAttribute('capture')).toBe('environment');
    expect(input.getAttribute('name')).toBe('photo');
    expect((input as HTMLInputElement).multiple).toBe(true);
  });

  it('invokes onFiles with the selection', () => {
    const onFiles = jest.fn();
    render(<FilePicker label="Cover photo" onFiles={onFiles} />);
    const file = pickFile();
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0][0]).toBe(file);
  });

  it('also fires the native onChange seam', () => {
    const onChange = jest.fn();
    render(<FilePicker label="Cover photo" onChange={onChange} />);
    pickFile();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('blocks selection when disabled', () => {
    const onFiles = jest.fn();
    render(<FilePicker label="Cover photo" onFiles={onFiles} disabled />);
    expect((screen.getByLabelText('Cover photo') as HTMLInputElement).disabled).toBe(true);
    pickFile();
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('merges className into the field shell', () => {
    render(<FilePicker label="Cover photo" className="legacy-hook" />);
    const shell = screen.getByText('Cover photo').closest('label');
    expect(shell?.classList.contains('ui-file-picker')).toBe(true);
    expect(shell?.classList.contains('legacy-hook')).toBe(true);
  });

  /**
   * Regression: Tailwind v4's `outline-none` zeroes `--tw-outline-style`, so
   * `focus-visible:outline-2` alone computes `outline-style: none` and the ring never draws.
   * `focus-visible:outline-solid` must be present to re-arm it.
   */
  it('re-arms the outline style the reset zeroes, so the focused ring draws', () => {
    render(<FilePicker label="Cover photo" />);
    const surface = screen.getByText('Cover photo').closest('.ui-file-picker__surface');
    expect(surface?.classList.contains('peer-focus-visible:outline-solid')).toBe(true);
    expect(surface?.classList.contains('peer-focus-visible:outline-[length:var(--focus-ring)]')).toBe(true);
  });
});