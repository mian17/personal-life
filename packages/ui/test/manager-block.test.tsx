import { render, screen } from '@testing-library/react';
import { ManagerBlock } from '../src/components/manager-block';
import { Card } from '../src/components/card';

describe('ManagerBlock', () => {
  it('renders the title as the page heading', () => {
    render(
      <ManagerBlock title="Tags" backHref="/notes">
        <span />
      </ManagerBlock>,
    );
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.tagName).toBe('H1');
    expect(heading.textContent).toBe('Tags');
  });

  it('renders the back IconLink with backHref and the default Back label', () => {
    render(
      <ManagerBlock title="Tags" backHref="/notes">
        <span />
      </ManagerBlock>,
    );
    const link = screen.getByRole('link', { name: 'Back' });
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/notes');
  });

  it('lets a backLabel override win', () => {
    render(
      <ManagerBlock title="Lists" backHref="/todos/lists" backLabel="Go back">
        <span />
      </ManagerBlock>,
    );
    expect(screen.getByRole('link', { name: 'Go back' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Back' })).toBeNull();
  });

  it('renders children inside the shell as-is, including a Card wrapper node', () => {
    render(
      <ManagerBlock title="Tags" backHref="/notes">
        <Card>
          <span data-testid="panel">panel</span>
        </Card>
      </ManagerBlock>,
    );
    const panel = screen.getByTestId('panel');
    expect(screen.getByRole('main').contains(panel)).toBe(true);
    expect(panel.parentElement!.className).toContain('ui-card');
  });
});
