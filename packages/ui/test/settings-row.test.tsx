import { fireEvent, render, screen } from '@testing-library/react';
import { SettingsRow } from '../src/components/settings-row';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('SettingsRow', () => {
  it('renders the label in the left column', () => {
    render(<SettingsRow label="Theme" control={<span />} />);
    const row = document.querySelector('.ui-settings-row')!;
    const text = row.querySelector('.ui-settings-row__text')!;
    const label = text.querySelector('.ui-settings-row__label')!;
    expect(label.textContent).toBe('Theme');
    expect(row.firstElementChild).toBe(text);
  });

  it('renders the control verbatim in the right column', () => {
    render(
      <SettingsRow label="Theme" control={<button type="button">Toggle</button>} />,
    );
    const control = document.querySelector('.ui-settings-row__control')!;
    expect(control.querySelector('button')!.textContent).toBe('Toggle');
    expect(document.querySelector('.ui-settings-row')!.lastElementChild).toBe(control);
  });

  it('renders a muted description under the label', () => {
    render(
      <SettingsRow label="Theme" description="System, light, or dark." control={<span />} />,
    );
    const desc = document.querySelector('.ui-settings-row__desc')!;
    expect(desc.textContent).toBe('System, light, or dark.');
    expect(desc.classList.contains('text-ink-2')).toBe(true);
  });

  it('omits the description when undefined', () => {
    render(<SettingsRow label="Theme" control={<span />} />);
    expect(document.querySelector('.ui-settings-row__desc')).toBeNull();
  });

  it('merges className instead of replacing the base class', () => {
    render(<SettingsRow label="Theme" control={<span />} className="legacy-hook" />);
    expect(classesOf(document.querySelector('.ui-settings-row')!)).toEqual(
      expect.arrayContaining(['legacy-hook', 'ui-settings-row']),
    );
  });


  describe('link row', () => {
    it('turns the label into a next/link anchor and adds the trailing chevron', () => {
      render(<SettingsRow label="Trash" href="/notes/trash" />);
      const label = screen.getByRole('link', { name: 'Trash' });

      expect(label.getAttribute('href')).toBe('/notes/trash');
      expect(label.hasAttribute('data-next-link')).toBe(true);
      expect(label.classList.contains('no-underline')).toBe(true);

      const control = document.querySelector('.ui-settings-row__control')!;
      expect(control.querySelector('svg')).not.toBeNull();
      expect(control.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    });

    it('keeps the control beside the link and before the chevron', () => {
      render(<SettingsRow label="Tags" href="/notes/tags" control={<span>3</span>} />);
      const control = document.querySelector('.ui-settings-row__control')!;

      expect(control.firstElementChild!.textContent).toBe('3');
      expect(control.lastElementChild!.tagName.toLowerCase()).toBe('svg');
    });

    it('renders a bare label with no chevron when there is no destination', () => {
      render(<SettingsRow label="Theme" control={<span />} />);
      const row = document.querySelector('.ui-settings-row')!;

      expect(row.querySelector('a')).toBeNull();
      expect(row.querySelector('svg')).toBeNull();
      expect(row.querySelector('.ui-settings-row__label')!.tagName).toBe('SPAN');
    });
  });

  describe('action row', () => {
    it('turns the label into a button that runs onClick, with the trailing chevron', () => {
      const onClick = jest.fn();
      render(<SettingsRow label="Send feedback" onClick={onClick} />);

      const trigger = screen.getByRole('button', { name: 'Send feedback' });
      expect(trigger.getAttribute('type')).toBe('button');
      fireEvent.click(trigger);
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(document.querySelector('.ui-settings-row__control svg')).not.toBeNull();
    });
  });

  // jsdom never applies media queries, so the narrow-screen behaviour is read
  // off the classes the row carries: any `max-sm`/`md:` switch would show up
  // here as the row restacking on a phone.
  describe('single-line layout at every width', () => {
    it('keeps one flex line, never stacking into a column', () => {
      render(<SettingsRow label="Theme" control={<span />} />);
      const row = document.querySelector('.ui-settings-row')!;

      expect(row.classList.contains('flex')).toBe(true);
      expect(row.classList.contains('flex-col')).toBe(false);
      expect(row.classList.contains('max-sm:flex-col')).toBe(false);
      expect(row.classList.contains('max-sm:items-stretch')).toBe(false);
    });

    it('lets the label column shrink and ellipsize, and the control keep its width', () => {
      render(
        <SettingsRow
          label="Reduce motion"
          description="Follows the system setting."
          control={<span>System</span>}
        />,
      );
      const text = document.querySelector('.ui-settings-row__text')!;
      const label = document.querySelector('.ui-settings-row__label')!;
      const desc = document.querySelector('.ui-settings-row__desc')!;
      const control = document.querySelector('.ui-settings-row__control')!;

      expect(text.classList.contains('min-w-0')).toBe(true);
      expect(text.classList.contains('flex-auto')).toBe(true);
      expect(label.classList.contains('truncate')).toBe(true);
      expect(desc.classList.contains('line-clamp-2')).toBe(true);
      // A compact control holds its size through the flex floor, not a frozen column.
      expect(control.classList.contains('shrink-0')).toBe(false);
      expect(control.classList.contains('min-w-0')).toBe(false);
    });
  });

  // A control can be prose (a status line where a switch cannot render yet). Prose has
  // to wrap inside the row: a frozen control column holds the whole sentence on one
  // line and pushes it past the card's clipped edge, leaving the label with no width.
  describe('prose control wrapping', () => {
    const COPY = 'Add this app to your Home Screen to turn on push reminders.';

    it('leaves the control column shrinkable so the copy wraps inside the row', () => {
      render(<SettingsRow label="Push reminders" control={<span>{COPY}</span>} />);
      const control = document.querySelector('.ui-settings-row__control')!;

      expect(control.classList.contains('shrink-0')).toBe(false);
      // The column stops at its longest word, which is what makes the copy wrap.
      expect(control.classList.contains('min-w-0')).toBe(false);
      expect(control.textContent).toBe(COPY);
    });

    it('gives the label column its own text as a basis, so it is not squeezed to nothing', () => {
      render(<SettingsRow label="Push reminders" control={<span>{COPY}</span>} />);
      const text = document.querySelector('.ui-settings-row__text')!;

      expect(text.classList.contains('flex-auto')).toBe(true);
      expect(text.classList.contains('flex-1')).toBe(false);
    });

    it('pins the chevron against the squashed column beside it', () => {
      render(<SettingsRow label="Tags" href="/notes/tags" control={<span>{COPY}</span>} />);
      const chevron = document.querySelector('.ui-settings-row__control svg')!;

      expect(chevron.classList.contains('shrink-0')).toBe(true);
    });
  });

  // The reference row is interactive end to end, so the hit area is the row, not the label's
  // glyphs: the label is the one interactive element and it stretches over the whole line.
  describe('whole-row hit area', () => {
    it('stretches the link over the row and raises the control above it', () => {
      render(<SettingsRow label="Trash" href="/notes/trash" control={<button>Clear</button>} />);
      const row = document.querySelector('.ui-settings-row')!;
      const label = screen.getByRole('link', { name: 'Trash' });
      const control = document.querySelector('.ui-settings-row__control')!;

      expect(row.classList.contains('relative')).toBe(true);
      expect(row.classList.contains('cursor-pointer')).toBe(true);
      expect(label.classList.contains('after:absolute')).toBe(true);
      expect(label.classList.contains('after:inset-0')).toBe(true);
      expect(control.classList.contains('relative')).toBe(true);
    });

    it('stretches the action button over the Support row', () => {
      const onClick = jest.fn();
      render(<SettingsRow label="Send feedback" description="Tell us." onClick={onClick} />);
      const trigger = screen.getByRole('button', { name: 'Send feedback' });

      expect(trigger.classList.contains('after:absolute')).toBe(true);
      expect(trigger.classList.contains('after:inset-0')).toBe(true);
      expect(document.querySelectorAll('.ui-settings-row button')).toHaveLength(1);
    });
  });

  // A visited anchor would otherwise take the UA `:visited` colour and repaint the title.
  describe('title ink', () => {
    it('pins the link label to the row ink so `:visited` cannot recolour it', () => {
      render(<SettingsRow label="Tags" href="/notes/tags" />);
      const label = screen.getByRole('link', { name: 'Tags' });

      expect(label.classList.contains('text-ink')).toBe(true);
    });

    it('pins the action label to the same ink', () => {
      render(<SettingsRow label="Send feedback" onClick={() => {}} />);
      const trigger = screen.getByRole('button', { name: 'Send feedback' });

      expect(trigger.classList.contains('text-ink')).toBe(true);
    });
  });
});
