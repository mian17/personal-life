'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { SearchField } from '@life/ui';

export function SearchBox({ q = '', tag }: { q?: string; tag?: string }) {
  const router = useRouter();

  const handleQueryChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams();
      if (tag) {
        params.set('tag', tag);
      }
      if (value) {
        params.set('q', value);
      }
      const qs = params.toString();
      router.replace(qs ? `/notes?${qs}` : '/notes', { scroll: false });
    },
    [tag, router],
  );

  return (
    <SearchField
      label="Search notes"
      placeholder="Search notes"
      value={q}
      onQueryChange={handleQueryChange}
    />
  );
}
