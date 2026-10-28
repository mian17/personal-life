import { render } from '@testing-library/react';
import { DueDate } from '../src/components/due-date';

function rootOf(): HTMLElement {
  return document.querySelector('.ui-due-date') as HTMLElement;
}

describe('DueDate', () => {
  it('renders the shared relative label for today', () => {
    render(<DueDate dueDate="2026-10-02" today="2026-10-02" />);
    expect(rootOf().textContent).toBe('Today');
  });

  it('renders the shared relative label for tomorrow', () => {
    render(<DueDate dueDate="2026-10-03" today="2026-10-02" />);
    expect(rootOf().textContent).toBe('Tomorrow');
  });

  it('renders the dd/mm/yyyy label (not raw ISO) for other dates', () => {
    render(<DueDate dueDate="2026-12-25" today="2026-10-02" />);
    expect(rootOf().textContent).toBe('25/12/2026');
  });

  it('renders No date when dueDate is null', () => {
    render(<DueDate dueDate={null} today="2026-10-02" />);
    expect(rootOf().textContent).toBe('No date');
  });

  it('is plain by default: state class present, no signal class', () => {
    render(<DueDate dueDate="2026-10-02" today="2026-10-02" />);
    const root = rootOf();
    expect(root.classList.contains('ui-due-date--today')).toBe(true);
    expect(root.classList.contains('ui-due-date--signal')).toBe(false);
  });

  it('signal adds the signal class alongside the overdue state class', () => {
    render(<DueDate dueDate="2026-10-01" today="2026-10-02" tone="signal" />);
    const root = rootOf();
    expect(root.classList.contains('ui-due-date--signal')).toBe(true);
    expect(root.classList.contains('ui-due-date--overdue')).toBe(true);
  });

  it('signal adds the signal class alongside the later state class', () => {
    render(<DueDate dueDate="2026-10-05" today="2026-10-02" tone="signal" />);
    const root = rootOf();
    expect(root.classList.contains('ui-due-date--signal')).toBe(true);
    expect(root.classList.contains('ui-due-date--later')).toBe(true);
  });

  it('merges className', () => {
    render(<DueDate dueDate="2026-10-02" today="2026-10-02" className="legacy-hook" />);
    expect(rootOf().classList.contains('legacy-hook')).toBe(true);
  });
});
