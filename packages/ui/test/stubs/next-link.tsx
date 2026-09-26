import type { AnchorHTMLAttributes, ReactNode } from 'react';

export interface NextLinkStubProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  children?: ReactNode;
}

/**
 * Test stub for `next/link` (mapped in package.json jest.moduleNameMapper).
 *
 * Production components import the real `next/link`; this renders the anchor
 * Next.js would render on the client so element semantics stay observable.
 */
export default function NextLinkStub({ href, children, ...rest }: NextLinkStubProps) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
