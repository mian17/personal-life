import { render, screen } from '@testing-library/react';
import { PageActions } from '../src/components/page-actions';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('PageActions', () => {
  it('renders a ui-page-actions container', () => {
    render(
      <PageActions>
        <button type="button">Empty Trash</button>
      </PageActions>,
    );
    const container = document.querySelector('.ui-page-actions')!;
    expect(container.tagName).toBe('DIV');
    expect(classesOf(container)).toEqual(['ui-page-actions']);
  });

  it('renders its children inside the container', () => {
    render(
      <PageActions>
        <button type="button">Empty Trash</button>
      </PageActions>,
    );
    const container = document.querySelector('.ui-page-actions')!;
    expect(container.contains(screen.getByRole('button', { name: 'Empty Trash' }))).toBe(true);
  });

  it('merges className instead of replacing it', () => {
    render(
      <PageActions className="legacy-hook">
        <span />
      </PageActions>,
    );
    expect(classesOf(document.querySelector('.ui-page-actions')!)).toEqual([
      'legacy-hook',
      'ui-page-actions',
    ]);
  });

  it('forwards arbitrary attributes', () => {
    render(
      <PageActions data-extra="1" aria-label="page actions">
        <span />
      </PageActions>,
    );
    const container = document.querySelector('.ui-page-actions')!;
    expect(container.getAttribute('data-extra')).toBe('1');
    expect(container.getAttribute('aria-label')).toBe('page actions');
  });
});
