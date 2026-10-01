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

  it('renders children in order inside the composed card surface', () => {
    render(
      <SettingsBlock title="Todos">
        <span data-testid="a">a</span>
        <span data-testid="b">b</span>
        <span data-testid="c">c</span>
      </SettingsBlock>,
    );
    const card = document.querySelector('.ui-card')!;
    const stack = card.querySelector('.ui-stack')!;
    expect(stack.querySelectorAll('[data-testid]')).toHaveLength(3);
    expect(card.textContent).toBe('abc');
    expect(document.querySelector('.ui-section')!.querySelector('.ui-card')).toBe(card);
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
