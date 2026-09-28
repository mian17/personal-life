'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { SearchField } from '@life/ui';

/**
 * The `/todos` search field. Routing stays in the app (`SearchField` is debounce
 * + visuals only); every other filter param is preserved.
 */
export function TodoSearchBox({
  q = '',
  listId,
  tag,
  done,
}: {
  q?: string;
  listId?: string;
  tag?: string;
  done?: string;
}) {
  const router = useRouter();

  const handleQueryChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams();
      if (listId) params.set('list', listId);
      if (tag) params.set('tag', tag);
      if (done) params.set('done', done);
      if (value) params.set('q', value);
      const qs = params.toString();
      router.replace(qs ? `/todos?${qs}` : '/todos', { scroll: false });
    },
    [listId, tag, done, router],
  );

  return (
    <SearchField
      label="Search todos"
      placeholder="Search todos"
      value={q}
      onQueryChange={handleQueryChange}
    />
  );
}
