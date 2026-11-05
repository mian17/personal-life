import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SnackbarProvider } from '@life/ui';
import TodosLayout from '../app/todos/layout';

describe('todos layout', () => {
  it('renders its children inside a SnackbarProvider', () => {
    const element = TodosLayout({ children: <span data-testid="child" /> });
    expect(isValidElement(element)).toBe(true);
    // RouteLayout wraps the segment in a provider plus the area's accent scope.
    const provider = (element as { props: { children: ReactNode } }).props.children;
    expect(isValidElement(provider) && provider.type).toBe(SnackbarProvider);
    expect(renderToStaticMarkup(<>{provider}</>)).toContain('data-testid="child"');
  });

  it('scopes the segment to the todos accent in the server markup', () => {
    const html = renderToStaticMarkup(<>{TodosLayout({ children: <span /> })}</>);
    expect(html).toContain('data-app="todos"');
  });
});
