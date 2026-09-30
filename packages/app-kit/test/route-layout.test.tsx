import { render } from '@testing-library/react';
import { RouteLayout, routeLayoutMetadata } from '../src/route-layout';

describe('routeLayoutMetadata', () => {
  it('returns the { manifest } metadata object', () => {
    expect(routeLayoutMetadata('/manifest-notes.json')).toEqual({ manifest: '/manifest-notes.json' });
    expect(routeLayoutMetadata('/manifest-todos.json')).toEqual({ manifest: '/manifest-todos.json' });
  });
});

describe('RouteLayout', () => {
  it('renders children with no wrapper element', () => {
    const { container } = render(
      <RouteLayout>
        <h1>Title</h1>
        <p>Body</p>
      </RouteLayout>,
    );
    expect(container.children).toHaveLength(2);
    expect(container.innerHTML).toBe('<h1>Title</h1><p>Body</p>');
  });
});
