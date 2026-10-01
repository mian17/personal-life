import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SnackbarProvider } from '@life/ui';
import TodosLayout from '../app/todos/layout';

describe('todos layout', () => {
  it('renders its children inside a SnackbarProvider', () => {
    const element = TodosLayout({ children: <span data-testid="child" /> });
    expect(isValidElement(element)).toBe(true);
    // RouteLayout passes through; its child is the provider wrapping the segment.
    const provider = (element as { props: { children: ReactNode } }).props.children;
    expect(isValidElement(provider) && provider.type).toBe(SnackbarProvider);
    expect(renderToStaticMarkup(<>{provider}</>)).toContain('data-testid="child"');
  });
});
