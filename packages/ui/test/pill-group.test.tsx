import { fireEvent, render, screen } from '@testing-library/react';
import { Pill } from '../src/components/pill';
import { PillGroup } from '../src/components/pill-group';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('PillGroup', () => {
  it('renders a ui-pill-group container around its pill children', () => {
    render(
      <PillGroup>
        <Pill>work</Pill>
        <Pill>home</Pill>
      </PillGroup>,
    );
    const group = document.querySelector('.ui-pill-group')!;
    expect(group.tagName).toBe('DIV');
    expect(classesOf(group)).toEqual(['ui-pill-group']);
    expect(group.children).toHaveLength(2);
  });

  it('forwards role and aria-label verbatim (the saved-tags group contract)', () => {
    render(
      <PillGroup role="group" aria-label="Saved tags">
        <Pill>work</Pill>
      </PillGroup>,
    );
    const group = screen.getByRole('group', { name: 'Saved tags' });
    expect(group.classList.contains('ui-pill-group')).toBe(true);
    expect(group.getAttribute('aria-label')).toBe('Saved tags');
  });

  it('renders the per-pill remove affordance from the Pill children', () => {
    const onRemove = jest.fn();
    render(
      <PillGroup role="group" aria-label="Saved tags">
        <Pill onRemove={onRemove} removeLabel="Remove tag work">
          work
        </Pill>
      </PillGroup>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag work' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('renders the optional label and actions slots', () => {
    render(
      <PillGroup
        role="group"
        aria-label="Saved tags"
        label="Saved tags"
        actions={<button type="button">Clear</button>}
      >
        <Pill>work</Pill>
      </PillGroup>,
    );
    const group = screen.getByRole('group', { name: 'Saved tags' });
    expect(group.textContent).toContain('Saved tags');
    expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy();
  });

  it('merges className instead of replacing it', () => {
    render(
      <PillGroup className="legacy-hook">
        <Pill>work</Pill>
      </PillGroup>,
    );
    expect(classesOf(document.querySelector('.ui-pill-group')!)).toEqual([
      'legacy-hook',
      'ui-pill-group',
    ]);
  });
});
