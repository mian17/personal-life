import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

describe('DueDate CSS (atoms.css)', () => {
  const css = readFileSync(join(__dirname, '..', 'src/styles/atoms.css'), 'utf8');
  const start = css.indexOf('/* ------------------------------------------------- DueDate */');
  const end = css.indexOf('/* ------------------------------------------------------------- Switch */');
  const section = css.slice(start, end);

  it('finds the DueDate section', () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
  });

  it('base rule is muted via the token', () => {
    expect(section).toMatch(/\.ui-due-date\s*\{\s*color:\s*var\(--muted\);\s*\}/);
  });

  it('signal overdue uses the danger token', () => {
    expect(section).toMatch(
      /\.ui-due-date--signal\.ui-due-date--overdue\s*\{\s*color:\s*var\(--danger\);\s*\}/,
    );
  });

  it('signal today and later use the danger-soft token', () => {
    expect(section).toMatch(
      /\.ui-due-date--signal\.ui-due-date--today,\s*\n?\s*\.ui-due-date--signal\.ui-due-date--later\s*\{\s*color:\s*var\(--danger-soft\);\s*\}/,
    );
  });

  it('contains no raw hex or px values', () => {
    expect(section).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(section).not.toMatch(/\d+px\b/);
  });
});
