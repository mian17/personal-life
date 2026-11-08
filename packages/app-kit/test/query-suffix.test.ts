import { withQuery } from '../src/query-suffix';

describe('withQuery', () => {
  it('leaves the path bare when there is nothing to ask for', () => {
    expect(withQuery('/api/notes', new URLSearchParams())).toBe('/api/notes');
  });

  it('appends one parameter behind the question mark', () => {
    expect(withQuery('/api/notes', new URLSearchParams({ limit: '50' }))).toBe('/api/notes?limit=50');
  });

  it('keeps two parameters in the order they were set', () => {
    const params = new URLSearchParams();
    params.set('limit', '20');
    params.set('cursor', 'c2');

    expect(withQuery('/api/todos', params)).toBe('/api/todos?limit=20&cursor=c2');
  });

  it('encodes a value the way the transport expects', () => {
    expect(withQuery('/api/tags', new URLSearchParams({ q: 'a b&c' }))).toBe('/api/tags?q=a+b%26c');
  });
});
