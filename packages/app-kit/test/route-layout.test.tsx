import { render } from '@testing-library/react';
import { RouteLayout, routeLayoutMetadata } from '../src/route-layout';

describe('routeLayoutMetadata', () => {
  it('returns the manifest, icon, and Apple Home Screen hints', () => {
    expect(routeLayoutMetadata('/manifest-notes.json', 'Notes', '/icon-notes.png')).toEqual({
      manifest: '/manifest-notes.json',
      icons: { icon: '/icon.svg', apple: '/icon-notes.png' },
      appleWebApp: { capable: true, title: 'Notes', statusBarStyle: 'default' },
    });
    expect(routeLayoutMetadata('/manifest-todos.json', 'Todos', '/icon-todos.png')).toEqual({
      manifest: '/manifest-todos.json',
      icons: { icon: '/icon.svg', apple: '/icon-todos.png' },
      appleWebApp: { capable: true, title: 'Todos', statusBarStyle: 'default' },
    });
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
