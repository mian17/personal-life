import { render } from '@testing-library/react';
import { RouteLayout } from '../src/route-layout';

/**
 * The body mirror is the only reason a portalled dialog paints its area's accent, so it has to be
 * exactly symmetric: set while the route is mounted, gone when it is not, and never invented for a
 * layout that declares no area.
 */
describe('PortalAccentScope', () => {
  afterEach(() => {
    delete document.body.dataset.app;
  });

  it('mirrors the mounted area onto body and removes it on unmount', () => {
    const { unmount } = render(
      <RouteLayout app="meals">
        <h1>Title</h1>
      </RouteLayout>,
    );

    expect(document.body.dataset.app).toBe('meals');

    unmount();

    expect(document.body.dataset.app).toBeUndefined();
  });

  it('sets nothing when the layout declares no area', () => {
    render(
      <RouteLayout>
        <h1>Title</h1>
      </RouteLayout>,
    );

    expect(document.body.dataset.app).toBeUndefined();
  });
});
