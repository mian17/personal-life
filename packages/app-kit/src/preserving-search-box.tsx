'use client';

import { SearchField } from '@life/ui';
import { useRouter } from 'next/navigation';
import { filterHref } from './filter-href';
import type { QueryParams, RoutePath } from './types';

export interface PreservingSearchBoxProps {
  /** Route to replace, e.g. `/notes` or `/todos`. */
  path: RoutePath;
  /** Controlled current query value. */
  q?: string;
  /** Other params to preserve verbatim; `q` is owned by this component. */
  params?: QueryParams;
  /** Accessible label for the underlying `@life/ui` `SearchField`. */
  label: string;
  /** Placeholder; defaults to `label`. */
  placeholder?: string;
}

/**
 * Parameter-preserving search box: composes `@life/ui`'s `SearchField` and owns
 * only the `useRouter` / `URLSearchParams` / `router.replace(..., {scroll:false})`
 * glue. Debounce belongs to `SearchField`.
 */
export function PreservingSearchBox({
  path,
  q,
  params,
  label,
  placeholder,
}: PreservingSearchBoxProps) {
  const router = useRouter();

  const handleQueryChange = (value: string) => {
    router.replace(filterHref({ path, current: { ...params, q }, overrides: { q: value } }), {
      scroll: false,
    });
  };

  return (
    <SearchField
      label={label}
      placeholder={placeholder ?? label}
      value={q}
      onQueryChange={handleQueryChange}
    />
  );
}
