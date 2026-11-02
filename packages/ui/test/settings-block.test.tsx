import { render, screen } from '@testing-library/react';
import { SettingsBlock } from '../src/components/settings-block';
import { SettingsRow } from '../src/components/settings-row';
import { ManagerBlock } from '../src/components/manager-block';

describe('SettingsBlock', () => {
  it('renders the title as the group heading', () => {
    render(
      <SettingsBlock title="Appearance">
        <span data-testid="body" />
      </SettingsBlock>,
    );
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.textContent).toBe('Appearance');
    expect(heading.classList.contains('ui-section__heading')).toBe(true);
  });

  it('omits the heading row when title is undefined', () => {
    render(
      <SettingsBlock>
        <span data-testid="body" />
      </SettingsBlock>,
    );
    expect(screen.queryByRole('heading')).toBeNull();
    expect(document.querySelector('.ui-section__heading-row')).toBeNull();
  });

  it('renders children in order on the flush card, one per divided row', () => {
    render(
      <SettingsBlock title="Todos">
        <span data-testid="a">a</span>
        <span data-testid="b">b</span>
        <span data-testid="c">c</span>
      </SettingsBlock>,
    );
    const card = document.querySelector('.ui-card')!;
    // The group owns the row geometry: the card is flush and one rows box inside it
    // carries the inset and the hairline between neighbours.
    expect(card.classList.contains('ui-card--flush')).toBe(true);
    const rows = card.querySelector('.ui-settings-block__rows')!;
    expect(rows.querySelectorAll('[data-testid]')).toHaveLength(3);
    expect(card.textContent).toBe('abc');
    expect(document.querySelector('.ui-section')!.querySelector('.ui-card')).toBe(card);
    expect(rows.classList.contains('divide-y')).toBe(true);
    expect(rows.classList.contains('[&>*]:px-[var(--s4)]')).toBe(true);
  });

  it('merges className onto the composed section', () => {
    render(
      <SettingsBlock className="legacy-hook">
        <span />
      </SettingsBlock>,
    );
    const section = document.querySelector('.ui-section')!;
    expect(section.classList.contains('ui-section')).toBe(true);
    expect(section.classList.contains('legacy-hook')).toBe(true);
  });

  it('composes under ManagerBlock with a single h1 and ordered rows', () => {
    render(
      <ManagerBlock title="Settings" backHref="/todos">
        <SettingsBlock title="Appearance">
          <SettingsRow label="Theme" control={<span />} />
        </SettingsBlock>
        <SettingsBlock title="Todos">
          <SettingsRow label="Eisenhower matrix" control={<span />} />
        </SettingsBlock>
      </ManagerBlock>,
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Settings');
    const labels = Array.from(
      document.querySelectorAll('.ui-settings-row__label'),
    ).map((el) => el.textContent);
    expect(labels).toEqual(['Theme', 'Eisenhower matrix']);
  });
});
