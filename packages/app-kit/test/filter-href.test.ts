import { filterHref } from '../src/filter-href';

/** Parse an href (absolute or relative) into its raw param bag. */
function parse(href: string): Record<string, string> {
  const [, qs] = href.split('?');
  return Object.fromEntries(new URLSearchParams(qs ?? ''));
}

describe('filterHref', () => {
  it('preserves other params across an override', () => {
    const href = filterHref({
      path: '/notes',
      current: { tag: '7', q: 'x' },
      overrides: { tag: '9' },
    });
    expect(parse(href)).toEqual({ tag: '9', q: 'x' });
  });

  it('drops keys overridden to undefined or empty string', () => {
    expect(parse(filterHref({ path: '/notes', current: { tag: '1', q: 'a' }, overrides: { tag: undefined } }))).toEqual(
      { q: 'a' },
    );
    expect(parse(filterHref({ path: '/notes', current: { tag: '1', q: 'a' }, overrides: { q: '' } }))).toEqual({
      tag: '1',
    });
  });

  it('preserves keys it does not override', () => {
    const href = filterHref({
      path: '/todos',
      current: { q: 'a', list: '3', done: 'true' },
      overrides: { list: undefined },
    });
    expect(parse(href)).toEqual({ q: 'a', done: 'true' });
  });

  it('emits the path alone with no trailing ? when nothing remains', () => {
    const href = filterHref({
      path: '/todos',
      current: { q: '', list: undefined, tag: undefined },
      overrides: {},
    });
    expect(href).toBe('/todos');
    expect(href).not.toContain('?');
  });

  it('keeps absolute paths absolute and relative paths verbatim', () => {
    expect(filterHref({ path: '/notes', current: { tag: '1' } }).startsWith('/notes?')).toBe(true);
    expect(filterHref({ path: 'list', current: { tag: '1' } })).toBe('list?tag=1');
    expect(filterHref({ path: 'list' })).toBe('list');
  });

  it('reproduces the notes call shape', () => {
    expect(
      parse(filterHref({ path: '/notes', current: { tag: '5', q: 'hello' }, overrides: { tag: undefined } })),
    ).toEqual({ q: 'hello' });
    expect(
      parse(filterHref({ path: '/notes', current: { tag: undefined, q: 'hello' }, overrides: { tag: '8' } })),
    ).toEqual({ tag: '8', q: 'hello' });
  });

  it('reproduces the todos call shape', () => {
    const href = filterHref({
      path: '/todos',
      current: { q: 'buy', list: '3', tag: '2', done: 'true' },
      overrides: { tag: undefined },
    });
    expect(parse(href)).toEqual({ q: 'buy', list: '3', done: 'true' });
  });
});
