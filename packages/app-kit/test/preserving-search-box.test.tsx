import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render } from '@testing-library/react';
import { PreservingSearchBox } from '../src/preserving-search-box';
import { routerStub } from './stubs/next-navigation';

describe('PreservingSearchBox', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    routerStub.replace.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders a searchbox labelled with the passed label', () => {
    const { getByRole } = render(<PreservingSearchBox path="/notes" label="Search notes" />);
    expect(getByRole('searchbox', { name: 'Search notes' })).toBeTruthy();
  });

  it('defaults the placeholder to the label', () => {
    const { getByRole } = render(<PreservingSearchBox path="/notes" label="Search notes" />);
    expect(getByRole('searchbox', { name: 'Search notes' }).getAttribute('placeholder')).toBe(
      'Search notes',
    );
  });

  it('debounces via SearchField and replaces once with the merged href', () => {
    const { getByRole } = render(
      <PreservingSearchBox path="/notes" q="" params={{ tag: '5' }} label="Search notes" />,
    );
    fireEvent.change(getByRole('searchbox', { name: 'Search notes' }), {
      target: { value: 'hello' },
    });
    expect(routerStub.replace).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(routerStub.replace).toHaveBeenCalledTimes(1);
    const [href, options] = routerStub.replace.mock.calls[0];
    expect(Object.fromEntries(new URLSearchParams(href.split('?')[1]))).toEqual({
      tag: '5',
      q: 'hello',
    });
    expect(options).toEqual({ scroll: false });
  });

  it('drops q when the value becomes empty', () => {
    const { getByRole } = render(
      <PreservingSearchBox path="/todos" q="old" params={{ list: '3' }} label="Search todos" />,
    );
    fireEvent.change(getByRole('searchbox', { name: 'Search todos' }), {
      target: { value: '' },
    });
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(routerStub.replace).toHaveBeenCalledWith('/todos?list=3', { scroll: false });
  });

  it('lets the q prop win over a q inside params', () => {
    const { getByRole } = render(
      <PreservingSearchBox path="/notes" q="current" params={{ q: 'stale' }} label="Search notes" />,
    );
    fireEvent.change(getByRole('searchbox', { name: 'Search notes' }), {
      target: { value: 'next' },
    });
    act(() => {
      jest.advanceTimersByTime(300);
    });
    const [href] = routerStub.replace.mock.calls[0];
    expect(href).toBe('/notes?q=next');
  });

  it('carries no fetch call and no visual markup beyond SearchField', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'preserving-search-box.tsx'), 'utf8');
    expect(source).not.toContain('fetch(');
    expect(source).toContain('<SearchField');
    expect(source).not.toMatch(
      /<(div|span|button|input|textarea|select|a|img|label|form|section|ul|li)\b/,
    );
  });
});
