import type { Todo } from '@life/shared';
import { dueDateState } from '@life/ui';
import { groupByQuadrant, isUrgent, quadrantOf, QUADRANTS } from '@/lib/matrix';

const TODAY = '2026-10-01';

function todo(
  id: string,
  dueDate: string | null,
  effectiveImportant: boolean,
  done = false,
): Todo {
  return {
    id,
    title: id,
    note: null,
    done,
    important: null,
    effectiveImportant,
    dueDate,
    repeat: null,
    repeatDays: null,
    reminderScheduledAt: null,
    listId: null,
    originService: null,
    tagIds: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    deletedAt: null,
    version: 0,
  };
}

describe('isUrgent', () => {
  it('is not urgent without a date', () => {
    expect(isUrgent(null, TODAY)).toBe(false);
    expect(isUrgent('', TODAY)).toBe(false);
  });

  it('treats a malformed date as not urgent', () => {
    expect(isUrgent('not-a-date', TODAY)).toBe(false);
    expect(dueDateState('not-a-date', TODAY)).toBe('none');
  });

  it('is urgent for a timed value due today and a timed value due tomorrow', () => {
    expect(isUrgent('2026-10-01T09:30', TODAY)).toBe(true);
    expect(isUrgent('2026-10-02T09:30', TODAY)).toBe(true);
  });

  it('leaves a date-only due date on the same day-granular rule', () => {
    expect(isUrgent('2026-10-01', TODAY)).toBe(true);
    expect(isUrgent('2026-10-02', TODAY)).toBe(true);
    expect(isUrgent('2026-10-03', TODAY)).toBe(false);
  });

  it('is urgent for overdue, today, and tomorrow', () => {
    expect(isUrgent('2026-09-30', TODAY)).toBe(true);
    expect(isUrgent('2026-10-01', TODAY)).toBe(true);
    expect(isUrgent('2026-10-02', TODAY)).toBe(true);
  });

  it('is not urgent for the day after tomorrow and later', () => {
    expect(isUrgent('2026-10-03', TODAY)).toBe(false);
    expect(isUrgent('2027-06-01', TODAY)).toBe(false);
  });

  it('handles month and year rollovers as tomorrow', () => {
    expect(isUrgent('2026-11-01', '2026-10-31')).toBe(true);
    expect(isUrgent('2027-01-01', '2026-12-31')).toBe(true);
  });
});

describe('quadrantOf', () => {
  it('maps all four (effectiveImportant, isUrgent) combinations', () => {
    expect(quadrantOf(todo('a', '2026-09-30', true), TODAY)).toBe('urgent-important');
    expect(quadrantOf(todo('b', '2026-09-30', false), TODAY)).toBe('urgent-not-important');
    expect(quadrantOf(todo('c', '2027-06-01', true), TODAY)).toBe('not-urgent-important');
    expect(quadrantOf(todo('d', '2027-06-01', false), TODAY)).toBe('not-urgent-not-important');
    expect(quadrantOf(todo('e', null, false), TODAY)).toBe('not-urgent-not-important');
  });
});

describe('groupByQuadrant', () => {
  it('returns the four quadrants in fixed order with the exact labels', () => {
    const grouped = groupByQuadrant([], TODAY);
    expect(grouped.map((b) => b.id)).toEqual([
      'urgent-important',
      'urgent-not-important',
      'not-urgent-important',
      'not-urgent-not-important',
    ]);
    expect(grouped.map((b) => b.label)).toEqual([
      'Urgent & Important',
      'Urgent & Not Important',
      'Not Urgent & Important',
      'Not Urgent & Not Important',
    ]);
    expect(grouped.map((b) => b.label)).toEqual(QUADRANTS.map((q) => q.label));
  });

  it('carries each quadrant tone and row tone (IV green heading, untinted row)', () => {
    const grouped = groupByQuadrant([], TODAY);
    expect(grouped.map((b) => b.tone)).toEqual(['danger', 'amber', 'accent', 'green']);
    expect(grouped.map((b) => b.rowTone)).toEqual(['danger', 'amber', 'accent', null]);
  });

  it('buckets todos by quadrant', () => {
    const todos = [
      todo('ui-1', '2026-09-30', true),
      todo('un-1', '2026-10-01', false),
      todo('ni-1', '2027-06-01', true),
      todo('nn-1', null, false),
      todo('ui-2', null, true),
    ];
    const byId = Object.fromEntries(
      groupByQuadrant(todos, TODAY).map((b) => [b.id, b.todos.map((t) => t.id)]),
    );
    expect(byId).toEqual({
      'urgent-important': ['ui-1'],
      'urgent-not-important': ['un-1'],
      'not-urgent-important': ['ni-1', 'ui-2'],
      'not-urgent-not-important': ['nn-1'],
    });
  });

  it('places no done todo in any quadrant', () => {
    const todos = [
      todo('ui-open', '2026-09-30', true),
      todo('nn-open', null, false),
      todo('ui-done', '2026-09-30', true, true),
      todo('nn-done', null, false, true),
    ];
    const grouped = groupByQuadrant(todos, TODAY);
    const allIds = grouped.flatMap((b) => b.todos.map((t) => t.id));
    expect(allIds).toEqual(['ui-open', 'nn-open']);
    expect(allIds).not.toContain('ui-done');
    expect(allIds).not.toContain('nn-done');
  });

  it('preserves input order within a quadrant', () => {
    const todos = [
      todo('c', '2026-09-01', true),
      todo('a', '2026-09-05', true),
      todo('b', '2026-09-09', true),
    ];
    const bucket = groupByQuadrant(todos, TODAY).find((b) => b.id === 'urgent-important')!;
    expect(bucket.todos.map((t) => t.id)).toEqual(['c', 'a', 'b']);
  });

  it('returns all four buckets including empty ones', () => {
    const grouped = groupByQuadrant([], TODAY);
    expect(grouped).toHaveLength(4);
    expect(grouped.every((b) => b.todos.length === 0)).toBe(true);
  });
});
