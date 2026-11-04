import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { CreateFeedbackInput, FeedbackSubmitResult } from '@life/shared';
import { SettingsShell } from '../src/components/settings-shell';
import { SettingsBlock } from '../src/components/settings-block';

// jsdom 20 has no `Crypto.randomUUID`; the browser supplies the real one.
let minted = 0;
(globalThis as unknown as { crypto: { randomUUID: () => string } }).crypto.randomUUID = () =>
  `00000000-0000-4000-8000-${String(++minted).padStart(12, '0')}`;

const REDUCE_MOTION_COPY = 'Follows the system setting. Turn it on in iOS Settings › Accessibility.';

function renderShell(children?: ReactNode) {
  const onSubmit = jest.fn(
    async (_input: CreateFeedbackInput): Promise<FeedbackSubmitResult> => ({
      ok: true,
      id: 'srv-1',
    }),
  );
  render(
    <SettingsShell title="Settings" backHref="/notes" app="notes" onSubmit={onSubmit}>
      {children}
    </SettingsShell>,
  );
  return { onSubmit };
}

/** The group headings in render order — every section the shell draws is a titled `SettingsBlock`. */
function headings(): string[] {
  return Array.from(document.querySelectorAll('h2')).map((heading) => heading.textContent ?? '');
}

describe('SettingsShell', () => {
  it('renders Appearance, Comfort, the app groups, Support, then the prototype line', () => {
    renderShell(
      <SettingsBlock title="Marker">
        <span />
      </SettingsBlock>,
    );

    expect(headings()).toEqual(['Appearance', 'Comfort', 'Marker', 'Support']);

    const footer = screen.getByText('Personal Life · prototype');
    const support = screen.getByRole('heading', { level: 2, name: 'Support' });
    expect(support.compareDocumentPosition(footer)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('draws the Appearance segment alone in its group, with no Theme row', () => {
    renderShell();

    const segment = document.querySelector('.ui-seg--theme')!;
    expect(segment.getAttribute('role')).toBe('group');
    expect(segment.getAttribute('aria-label')).toBe('Appearance');
    expect(segment.className).toContain('w-full');

    expect(screen.queryByText('Theme')).toBeNull();
    expect(document.body.textContent).not.toContain('System, light, or dark.');
  });

  it('reports the Reduce motion setting with the standard copy and a static System pill', () => {
    renderShell();

    const row = screen.getByText('Reduce motion').closest('.ui-settings-row')!;
    expect(row.querySelector('.ui-settings-row__desc')!.textContent).toBe(REDUCE_MOTION_COPY);
    expect(row.querySelector('.ui-settings-row__control')!.textContent).toBe('System');
    expect(document.querySelector('[role="switch"]')).toBeNull();
  });

  it('renders the Send feedback row as the dialog trigger for the given app', async () => {
    const { onSubmit } = renderShell();

    expect(screen.getByText('Tell us what got in the way.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'a title' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), {
      target: { value: 'an idea' },
    });
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
  });

  it('forwards title, backHref and the default Back label to the manager chrome', () => {
    renderShell();

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Settings');
    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/notes');
  });

  it('lets a backLabel override reach the back control', () => {
    render(
      <SettingsShell
        title="Settings"
        backHref="/todos"
        backLabel="Go back"
        app="todos"
        onSubmit={jest.fn()}
      />,
    );

    expect(screen.getByRole('link', { name: 'Go back' }).getAttribute('href')).toBe('/todos');
  });

  it('carries the meta tier token classes on the prototype line', () => {
    renderShell();

    const footer = screen.getByText('Personal Life · prototype');
    expect(footer.tagName).toBe('P');
    expect(footer.className.split(/\s+/)).toEqual(
      expect.arrayContaining([
        'mt-[var(--s6)]',
        'text-ink-2',
        'text-[length:var(--fs-meta)]',
        'leading-[var(--lh-meta)]',
      ]),
    );
  });
});
