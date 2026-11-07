import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  decodeCursor,
  encodeCursor,
  paginate,
} from '../src/index';

/** A row in `timestamp DESC, id DESC` order — the notes list's order. */
type Ranked = { id: string; at: string };

/** Newest first, `id DESC` breaking a tie: the notes order. */
const newestFirst = (rows: Ranked[]): Ranked[] =>
  [...rows].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));

/** The strictly-after test of that order. */
const afterNewestFirst = (row: Ranked, at: string[]): boolean =>
  row.at < at[0] || (row.at === at[0] && row.id < at[1]);

const pageOf = (rows: Ranked[], limit: number, cursor?: string) =>
  paginate(rows, {
    limit,
    cursor,
    keyOf: (row) => [row.at, row.id],
    after: afterNewestFirst,
  });

/** Walk every page of a list, collecting ids — the no-dup/no-skip check. */
function walk(rows: Ranked[], limit: number): string[] {
  const seen: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = pageOf(rows, limit, cursor);
    seen.push(...page.rows.map((row) => row.id));
    if (page.nextCursor === null) return seen;
    cursor = page.nextCursor;
  }
}

const ranked = (id: string, at: string): Ranked => ({ id, at });

describe('cursor codec', () => {
  it('round-trips a key of any width', () => {
    for (const key of [['only'], ['a', 'b'], ['2026-01-01T00:00:00.000Z', 'id-1']]) {
      expect(decodeCursor(encodeCursor(key))).toEqual(key);
    }
  });

  it('encodes to base64 over the |-joined key, so the wire format is unchanged', () => {
    expect(encodeCursor(['2026-01-01T00:00:00.000Z', 'id-1'])).toBe(
      Buffer.from('2026-01-01T00:00:00.000Z|id-1').toString('base64'),
    );
  });

  it.each([
    ['junk that is not base64', 'not base64!!'],
    ['a non-canonical re-encoding', Buffer.from('x|y').toString('base64').slice(0, -1)],
    ['an empty part', Buffer.from('a||b').toString('base64')],
  ])('rejects %s with a 400', (_label, cursor) => {
    expect(() => decodeCursor(cursor)).toThrow(BadRequestException);
  });
});

describe('paginate', () => {
  it('serves the first page without a cursor', () => {
    const rows = newestFirst([ranked('b', '2026-01-02'), ranked('a', '2026-01-01')]);
    expect(pageOf(rows, 1)).toEqual({
      rows: [rows[0]],
      nextCursor: encodeCursor([rows[0].at, rows[0].id]),
    });
  });

  it('serves a middle page from the cursor it was handed', () => {
    const rows = newestFirst([
      ranked('c', '2026-01-03'),
      ranked('b', '2026-01-02'),
      ranked('a', '2026-01-01'),
    ]);
    const first = pageOf(rows, 1);
    expect(pageOf(rows, 1, first.nextCursor!).rows).toEqual([rows[1]]);
  });

  it('returns a null nextCursor on the last page', () => {
    const rows = newestFirst([ranked('b', '2026-01-02'), ranked('a', '2026-01-01')]);
    const first = pageOf(rows, 1);
    expect(pageOf(rows, 1, first.nextCursor!)).toEqual({ rows: [rows[1]], nextCursor: null });
  });

  it('neither repeats nor skips a row across pages, including a full tie', () => {
    const rows = newestFirst([
      ranked('e', '2026-01-01'),
      ranked('d', '2026-01-01'),
      ranked('c', '2026-01-01'),
      ranked('b', '2026-01-02'),
      ranked('a', '2026-01-01'),
    ]);
    for (const limit of [1, 2, 3, 5]) {
      expect(walk(rows, limit)).toEqual(rows.map((row) => row.id));
    }
  });

  it('pages on the key, not the row, so a deleted boundary row skips nothing', () => {
    const rows = newestFirst([ranked('c', '2026-01-03'), ranked('b', '2026-01-02')]);
    const first = pageOf(rows, 1);
    const rest = [rows[0], ...newestFirst([ranked('a', '2026-01-01')])];
    expect(pageOf(rest, 1, first.nextCursor!).rows.map((row) => row.id)).toEqual(['a']);
  });

  it('holds the todos undated-last order, including across the dated boundary', () => {
    // `~` is the undated first component; dated rows ascend, undated follow by
    // `createdAt DESC`. This is the second real order the seam must cover.
    type Todoish = { id: string; due: string; createdAt: string };
    const sorted: Todoish[] = [
      { id: 'early', due: '2026-01-01', createdAt: '2026-08-08T00:00:00.000Z' },
      { id: 'late', due: '2026-02-01', createdAt: '2026-08-08T00:00:00.000Z' },
      { id: 'undated-new', due: '~', createdAt: '2026-08-08T00:00:02.000Z' },
      { id: 'undated-old', due: '~', createdAt: '2026-08-08T00:00:01.000Z' },
    ];
    const afterTodo = (row: Todoish, at: string[]): boolean => {
      const [due, createdAt, id] = at;
      if (due === '~') {
        if (row.due !== '~') return false;
        return row.createdAt < createdAt || (row.createdAt === createdAt && row.id < id);
      }
      if (row.due === '~') return true;
      if (row.due > due) return true;
      if (row.due < due) return false;
      return row.createdAt < createdAt || (row.createdAt === createdAt && row.id < id);
    };
    const seen: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = paginate(sorted, {
        limit: 2,
        cursor,
        keyOf: (row) => [row.due, row.createdAt, row.id],
        after: afterTodo,
      });
      seen.push(...page.rows.map((row) => row.id));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(sorted.map((row) => row.id));
  });

  it.each([
    [0, 1],
    [-5, 1],
    [1, 1],
    [200, 200],
    [201, 200],
    [10_000, MAX_PAGE_LIMIT],
    [Number.NaN, DEFAULT_PAGE_LIMIT],
  ])('clamps a limit of %p to %p rows', (limit, expected) => {
    const rows = Array.from({ length: 250 }, (_, i) => ranked(`r${i}`, '2026-01-01'));
    expect(pageOf(rows, limit).rows).toHaveLength(expected);
  });
});
