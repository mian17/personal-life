import { render } from '@testing-library/react';
import { Facts, FactsRow } from '../src/components/facts';

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean).sort();
}

describe('Facts', () => {
  it('renders a grid container holding its rows', () => {
    const { container } = render(
      <Facts>
        <FactsRow label="Protein" value="41 g" />
      </Facts>,
    );
    const facts = container.firstElementChild as HTMLElement;
    expect(facts.tagName).toBe('DIV');
    expect(classesOf(facts)).toContain('ui-facts');
    expect(classesOf(facts)).toContain('grid');
    expect(facts.children).toHaveLength(1);
  });

  it('merges className and forwards attributes', () => {
    const { container } = render(<Facts className="legacy-hook" data-extra="1" />);
    const facts = container.firstElementChild as HTMLElement;
    expect(classesOf(facts)).toEqual(expect.arrayContaining(['legacy-hook', 'ui-facts']));
    expect(facts.getAttribute('data-extra')).toBe('1');
  });
});

describe('FactsRow', () => {
  it('renders the label left and the value right', () => {
    const { container } = render(<FactsRow label="Due" value="Today, 17:00" />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.tagName).toBe('DIV');
    const [label, value] = Array.from(row.children) as HTMLElement[];
    expect(label.textContent).toBe('Due');
    expect(value.textContent).toBe('Today, 17:00');
    expect(classesOf(label)).toContain('ui-fact__label');
    expect(classesOf(value)).toContain('ui-fact__v');
  });

  it('draws the hairline under every row but the last', () => {
    const { container } = render(<FactsRow label="List" value="Errands" />);
    const row = container.firstElementChild as HTMLElement;
    expect(classesOf(row)).toEqual(
      expect.arrayContaining(['border-b', 'border-line', 'last:border-b-0']),
    );
    expect(classesOf(row)).toContain('justify-between');
    expect(classesOf(row)).toContain('items-baseline');
  });

  it('puts the value in the second ink tier with tabular figures', () => {
    const { container } = render(<FactsRow label="Tags" value="health" />);
    const value = container.firstElementChild?.children[1] as HTMLElement;
    expect(classesOf(value)).toEqual(expect.arrayContaining(['text-ink-2', 'tabular-nums']));
  });

  it('merges className instead of replacing it', () => {
    const { container } = render(
      <FactsRow className="legacy-hook" label="Repeat" value="Monthly" />,
    );
    const row = container.firstElementChild as HTMLElement;
    expect(classesOf(row)).toEqual(expect.arrayContaining(['legacy-hook', 'ui-fact']));
  });
});
