import { render, screen } from '@testing-library/react';
import { Disclosure } from '../src/components/disclosure';

describe('Disclosure', () => {
  it('renders a native <details>/<summary>, collapsed by default', () => {
    render(
      <Disclosure label="More">
        <span data-testid="body">one</span>
      </Disclosure>,
    );
    const details = document.querySelector('.ui-disclosure')!;
    expect(details.tagName).toBe('DETAILS');
    expect(details.hasAttribute('open')).toBe(false);
    const summary = document.querySelector('.ui-disclosure__summary')!;
    expect(summary.tagName).toBe('SUMMARY');
    expect(summary.textContent).toBe('More');
  });

  it('sets the open attribute when defaultOpen is true', () => {
    render(
      <Disclosure label="More" defaultOpen>
        x
      </Disclosure>,
    );
    expect(document.querySelector('.ui-disclosure')!.hasAttribute('open')).toBe(true);
  });

  it('renders children inside the body, within the details', () => {
    render(
      <Disclosure label="More">
        <span data-testid="body">one</span>
      </Disclosure>,
    );
    const body = document.querySelector('.ui-disclosure__body')!;
    const details = document.querySelector('.ui-disclosure')!;
    expect(body.tagName).toBe('DIV');
    expect(body.contains(screen.getByTestId('body'))).toBe(true);
    expect(details.contains(body)).toBe(true);
  });

  it('merges className instead of replacing it', () => {
    render(
      <Disclosure label="More" className="legacy-hook">
        x
      </Disclosure>,
    );
    const details = document.querySelector('.ui-disclosure')!;
    expect(details.classList.contains('ui-disclosure')).toBe(true);
    expect(details.classList.contains('legacy-hook')).toBe(true);
  });
});
