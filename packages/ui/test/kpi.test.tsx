import { render, screen } from '@testing-library/react';
import { Kpi } from '../src/components/kpi';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('Kpi', () => {
  it('renders the value and the unit in one baseline row', () => {
    const { container } = render(<Kpi value="820" unit="kcal" />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.tagName).toBe('DIV');
    expect(classesOf(row)).toContain('ui-kpi');
    expect(classesOf(row)).toContain('items-baseline');

    const [value, unit] = Array.from(row.children) as HTMLElement[];
    expect(value.textContent).toBe('820');
    expect(unit.textContent).toBe('kcal');
    expect(classesOf(value)).toContain('ui-kpi__value');
    expect(classesOf(unit)).toContain('ui-kpi__unit');
  });

  it('takes the KPI token step and tabular figures', () => {
    const { container } = render(<Kpi value="1,180" unit="of 2,050 kcal" />);
    const row = container.firstElementChild as HTMLElement;
    const value = row.children[0];
    expect(classesOf(value)).toEqual(
      expect.arrayContaining([
        'text-[length:var(--fs-kpi)]',
        'leading-[var(--lh-kpi)]',
        'tracking-[var(--tracking-kpi)]',
        'tabular-nums',
      ]),
    );

    const unit = row.children[1];
    expect(classesOf(unit)).toEqual(
      expect.arrayContaining([
        'text-[length:var(--fs-chip)]',
        'text-ink-2',
        'tracking-[var(--tracking-none)]',
      ]),
    );
  });

  it('merges className instead of replacing it', () => {
    const { container } = render(<Kpi className="legacy-hook" value="0" unit="kcal" />);
    const row = container.firstElementChild as HTMLElement;
    expect(classesOf(row)).toEqual(expect.arrayContaining(['legacy-hook', 'ui-kpi']));
  });

  it('accepts a node for the value and the unit', () => {
    render(
      <Kpi
        value={<span data-testid="number">820</span>}
        unit={<strong data-testid="unit">kcal</strong>}
      />,
    );
    expect(screen.getByTestId('number').textContent).toBe('820');
    expect(screen.getByTestId('unit').textContent).toBe('kcal');
  });
});
